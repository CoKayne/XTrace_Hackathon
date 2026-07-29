import assert from "node:assert/strict";
import test from "node:test";

import {
  createMemorySourceRegistry,
  createSupabaseSourceRegistry,
  type CreateSourceRevisionInput,
} from "../../db/repositories/source-registry";

function revisionInput(
  workspaceId: string,
  sourceId: string,
  id: string,
  contentHash: string,
): CreateSourceRevisionInput {
  return {
    id,
    workspaceId,
    sourceId,
    contentHash,
    objectKey: `private/${workspaceId}/${sourceId}`,
    objectVersion: contentHash,
    contentType: "application/pdf",
    extractorId: "pdf-text",
    extractorVersion: "1.0.0",
    extractedAt: "2026-07-28T10:00:00.000Z",
    createdAt: "2026-07-28T10:00:01.000Z",
  };
}

test("a correction appends revision two without changing revision one", async () => {
  const registry = createMemorySourceRegistry();
  const first = await registry.createInitialRevision(
    revisionInput("workspace_one", "source_one", "revision_one", "hash_a"),
  );
  const second = await registry.appendRevision({
    ...revisionInput(
      "workspace_one",
      "source_one",
      "revision_two",
      "hash_b",
    ),
    supersedesRevisionId: first.id,
  });

  assert.equal(first.revision, 1);
  assert.equal(second.revision, 2);
  assert.equal(
    (
      await registry.getRevision({
        workspaceId: first.workspaceId,
        revisionId: first.id,
      })
    )?.contentHash,
    "hash_a",
  );
});

test("revision identity is workspace-scoped and delimiter-safe", async () => {
  const registry = createMemorySourceRegistry();
  await registry.createInitialRevision(
    revisionInput("workspace:a", "source", "external", "hash_one"),
  );
  await registry.createInitialRevision(
    revisionInput("workspace", "source", "a:external", "hash_two"),
  );

  assert.equal(
    (
      await registry.getRevision({
        workspaceId: "workspace:a",
        revisionId: "external",
      })
    )?.contentHash,
    "hash_one",
  );
  assert.equal(
    (
      await registry.getRevision({
        workspaceId: "workspace",
        revisionId: "a:external",
      })
    )?.contentHash,
    "hash_two",
  );
  assert.equal(
    await registry.getRevision({
      workspaceId: "workspace_other",
      revisionId: "external",
    }),
    null,
  );
});

test("initial revision replay is idempotent but cannot replace revision one", async () => {
  const registry = createMemorySourceRegistry();
  const input = revisionInput(
    "workspace_one",
    "source_one",
    "revision_one",
    "hash_a",
  );

  const first = await registry.createInitialRevision(input);
  const replay = await registry.createInitialRevision(input);
  assert.deepEqual(replay, first);

  await assert.rejects(
    registry.createInitialRevision({ ...input, contentHash: "hash_changed" }),
    /revision 1|immutable|different/i,
  );
});

test("append requires the exact current revision and concurrent retries cannot duplicate numbers", async () => {
  const registry = createMemorySourceRegistry();
  const first = await registry.createInitialRevision(
    revisionInput("workspace_one", "source_one", "revision_one", "hash_a"),
  );

  const outcomes = await Promise.allSettled([
    registry.appendRevision({
      ...revisionInput(
        "workspace_one",
        "source_one",
        "revision_two_a",
        "hash_b",
      ),
      supersedesRevisionId: first.id,
    }),
    registry.appendRevision({
      ...revisionInput(
        "workspace_one",
        "source_one",
        "revision_two_b",
        "hash_c",
      ),
      supersedesRevisionId: first.id,
    }),
  ]);

  assert.equal(
    outcomes.filter((outcome) => outcome.status === "fulfilled").length,
    1,
  );
  assert.equal(
    outcomes.filter((outcome) => outcome.status === "rejected").length,
    1,
  );
  assert.equal(
    outcomes.find((outcome) => outcome.status === "fulfilled")?.value.revision,
    2,
  );

  await assert.rejects(
    registry.appendRevision({
      ...revisionInput(
        "workspace_one",
        "source_one",
        "revision_three",
        "hash_d",
      ),
      supersedesRevisionId: first.id,
    }),
    /current|previous|supersedes/i,
  );
});

test("annotations are append-only, nonblank, and cannot cross workspaces", async () => {
  const registry = createMemorySourceRegistry();
  const revision = await registry.createInitialRevision(
    revisionInput("workspace_one", "source_one", "revision_one", "hash_a"),
  );

  await registry.annotateRevision({
    workspaceId: revision.workspaceId,
    revisionId: revision.id,
    kind: "identity_corrected",
    reason: "The company identity was corrected after review.",
    supersededByRunId: null,
  });
  assert.equal(
    (
      await registry.listAnnotations({
        workspaceId: revision.workspaceId,
        revisionId: revision.id,
      })
    )[0]?.reason,
    "The company identity was corrected after review.",
  );

  await assert.rejects(
    registry.annotateRevision({
      workspaceId: revision.workspaceId,
      revisionId: revision.id,
      kind: "retracted",
      reason: "  ",
      supersededByRunId: null,
    }),
    /reason/i,
  );
  await assert.rejects(
    registry.annotateRevision({
      workspaceId: "workspace_other",
      revisionId: revision.id,
      kind: "retracted",
      reason: "Wrong tenant.",
      supersededByRunId: null,
    }),
    /revision|workspace/i,
  );
});

test("Supabase revisions use atomic workspace-scoped RPC requests", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const firstRow = {
    id: "revision_one",
    workspace_id: "workspace_one",
    source_id: "source_one",
    revision: 1,
    content_hash: "hash_a",
    object_key: "private/workspace_one/source_one",
    object_version: "hash_a",
    content_type: "application/pdf",
    extractor_id: "pdf-text",
    extractor_version: "1.0.0",
    extracted_at: "2026-07-28T10:00:00.000Z",
    supersedes_revision_id: null,
    created_at: "2026-07-28T10:00:01.000Z",
  };
  const repository = createSupabaseSourceRegistry({
    url: "https://example.supabase.co",
    serviceRoleKey: "test-service-role-key",
    fetchImpl: async (input, init = {}) => {
      requests.push({ url: String(input), init });
      if (String(input).includes("/rpc/")) return Response.json([firstRow]);
      return Response.json([]);
    },
  });

  await repository.createInitialRevision(
    revisionInput(
      "workspace_one",
      "source_one",
      "revision_one",
      "hash_a",
    ),
  );
  await repository.getRevision({
    workspaceId: "workspace_one",
    revisionId: "revision_one",
  });

  assert.equal(
    requests[0].url,
    "https://example.supabase.co/rest/v1/rpc/create_initial_source_revision",
  );
  assert.equal(
    JSON.parse(String(requests[0].init.body)).p_revision.workspaceId,
    "workspace_one",
  );
  const readUrl = new URL(requests[1].url);
  assert.equal(readUrl.searchParams.get("workspace_id"), "eq.workspace_one");
  assert.equal(readUrl.searchParams.get("id"), "eq.revision_one");
});
