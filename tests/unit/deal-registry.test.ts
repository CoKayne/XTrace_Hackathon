import assert from "node:assert/strict";
import test from "node:test";

import {
  createMemoryDealRegistry,
  createSupabaseDealRegistry,
  eligibleDealSnapshotFingerprint,
  sourceRevisionFingerprint,
  type ConfirmSourceAssignmentInput,
  type RegisteredDeal,
} from "../../db/repositories/deal-registry";
import {
  createMemorySourceRegistry,
  type CreateSourceRevisionInput,
  type SourceRegistry,
} from "../../db/repositories/source-registry";
import type {
  DealMemoryBundle,
  DealStatus,
} from "../../lib/contracts/domain";
import { backfillPreloadedSourceRegistry } from "../../scripts/backfill-source-registry";

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

function bundle(
  dealId: string,
  companyName: string,
  status: DealStatus = "screening",
): DealMemoryBundle {
  return {
    dealId,
    companyName,
    status,
    facts: [],
    interactions: [],
  };
}

async function assignment(
  sourceRegistry: SourceRegistry,
  overrides: Partial<ConfirmSourceAssignmentInput> & {
    workspaceId: string;
    dealId: string;
    sourceId: string;
  },
): Promise<ConfirmSourceAssignmentInput> {
  const sourceRevision = await sourceRegistry.createInitialRevision(
    revisionInput(
      overrides.workspaceId,
      overrides.sourceId,
      `${overrides.workspaceId}:${overrides.sourceId}:revision:1`,
      `hash_${overrides.sourceId}`,
    ),
  );
  const companyName = overrides.companyName ?? `Company ${overrides.dealId}`;
  return {
    requestId: overrides.requestId ?? `request:${overrides.dealId}`,
    workspaceId: overrides.workspaceId,
    dealId: overrides.dealId,
    companyId: overrides.companyId ?? `company:${overrides.dealId}`,
    companyName,
    status: overrides.status ?? "screening",
    sourceRevisionId: sourceRevision.id,
    assignedByUserId: overrides.assignedByUserId ?? "user_one",
    reason: overrides.reason ?? "Confirmed source ownership.",
    confirmedAt: overrides.confirmedAt ?? "2026-07-28T11:00:00.000Z",
    memoryBundle: overrides.memoryBundle ??
      bundle(overrides.dealId, companyName, overrides.status),
  };
}

test("seed and confirmed upload share one analysis-eligible query", async () => {
  const sources = createMemorySourceRegistry();
  const registry = createMemoryDealRegistry({ sourceRegistry: sources });
  await registry.confirmSourceAssignment(await assignment(sources, {
    workspaceId: "workspace_demo",
    dealId: "deal_seed_7bridges",
    sourceId: "doc_7bridges",
  }));
  await registry.confirmSourceAssignment(await assignment(sources, {
    workspaceId: "workspace_demo",
    dealId: "deal_uploaded",
    sourceId: "upload_one",
  }));

  const ids = (await registry.listAnalysisEligibleBundles("workspace_demo"))
    .map((item) => item.dealId)
    .sort();
  assert.deepEqual(ids, ["deal_seed_7bridges", "deal_uploaded"]);
});

test("the registry captures one canonical eligible Deal snapshot token", async () => {
  const sources = createMemorySourceRegistry();
  const registry = createMemoryDealRegistry({ sourceRegistry: sources });
  await registry.confirmSourceAssignment(await assignment(sources, {
    workspaceId: "workspace_demo",
    dealId: "deal_one",
    sourceId: "source_one",
  }));
  const snapshotRegistry = registry as typeof registry & {
    getAnalysisEligibleSnapshot?: (
      workspaceId: string,
    ) => Promise<{
      count: number;
      dealIds: string[];
      fingerprint: string;
    }>;
  };
  assert.equal(typeof snapshotRegistry.getAnalysisEligibleSnapshot, "function");
  const snapshot = await snapshotRegistry.getAnalysisEligibleSnapshot!(
    "workspace_demo",
  );
  assert.deepEqual(snapshot.dealIds, ["deal_one"]);
  assert.equal(snapshot.count, 1);
  assert.match(snapshot.fingerprint, /^sha256:[0-9a-f]{64}$/);
});

test("current Deal status overlays stored memory and invalidates the eligible snapshot", async () => {
  const sources = createMemorySourceRegistry();
  const registry = createMemoryDealRegistry({ sourceRegistry: sources });
  const input = await assignment(sources, {
    workspaceId: "workspace_one",
    dealId: "deal_one",
    sourceId: "source_one",
    status: "screening",
  });
  await registry.confirmSourceAssignment(input);
  const before = await registry.getAnalysisEligibleSnapshot("workspace_one");

  await registry.confirmSourceAssignment({
    ...input,
    requestId: "request:deal_one:invested",
    status: "invested",
    memoryBundle: undefined,
  });
  const deal = await registry.findForWorkspace({
    workspaceId: "workspace_one",
    dealId: "deal_one",
  });
  const [currentBundle] = await registry.listAnalysisEligibleBundles(
    "workspace_one",
  );
  const after = await registry.getAnalysisEligibleSnapshot("workspace_one");

  assert.deepEqual(
    {
      dealStatus: deal?.status,
      bundleStatus: currentBundle.status,
      beforeFingerprint: before.fingerprint,
      afterFingerprint: after.fingerprint,
      fingerprintChanged: before.fingerprint !== after.fingerprint,
    },
    {
      dealStatus: "invested",
      bundleStatus: "invested",
      beforeFingerprint:
        "sha256:c1f6acc223c51045fa1fc4eeab89f235d964cfb069cbaa95b60bba189384c1ee",
      afterFingerprint:
        "sha256:9c0439820138d64ebd017797de60545d93764dc0b9f5625714dae8b6939a907e",
      fingerprintChanged: true,
    },
  );
});

test("eligible snapshot v2 matches the live PostgreSQL three-Deal vector", () => {
  const revisionFingerprints = [
    "sha256:2764a94f88e772e7887311a8d4eeb121a5bf3a65f5af597897320cf90262094b",
    "sha256:db9db68e550e099f02d262f7ed6bf789146278834f986131f3df55044d9a4721",
    "sha256:873709984032de9cef0c7cbb6ca63326d375dde9c72201c5e194ad1a921815ce",
  ];
  const deals: RegisteredDeal[] = revisionFingerprints.map(
    (fingerprint, index) => ({
      id: `snapshot_deal_${index + 1}`,
      workspaceId: "workspace_snapshot",
      companyId: `snapshot_company_${index + 1}`,
      companyName: `Company ${index + 1}`,
      status: "screening",
      analysisEligibleAt: "2026-07-28T13:45:00.000Z",
      activeSourceRevisionFingerprint: fingerprint,
      activeSourceRevisionIds: [`snapshot_revision_${index + 1}`],
    }),
  );

  assert.equal(
    eligibleDealSnapshotFingerprint(deals),
    "sha256:4d138886426eb83652d4e19dbb999869952b235025a84043bfc0b91897913ea2",
  );
});

test("confirmation is retry-idempotent and does not change upload or XTrace state", async () => {
  const sources = createMemorySourceRegistry();
  const registry = createMemoryDealRegistry({ sourceRegistry: sources });
  const input = await assignment(sources, {
    workspaceId: "workspace_one",
    dealId: "deal_uploaded",
    sourceId: "upload_one",
  });

  const first = await registry.confirmSourceAssignment(input);
  const retry = await registry.confirmSourceAssignment(input);

  assert.equal(first.newlyEligible, true);
  assert.equal(retry.newlyEligible, false);
  assert.deepEqual(retry.deal, first.deal);
  assert.equal(registry.inspect().assignments.length, 1);
  assert.deepEqual(registry.inspect().externalEffects, []);
});

test("confirmation request ids bind every immutable semantic field", async () => {
  const changes: Array<[string, (input: ConfirmSourceAssignmentInput) => ConfirmSourceAssignmentInput]> = [
    ["actor", (input) => ({ ...input, assignedByUserId: "user_other" })],
    ["reason", (input) => ({ ...input, reason: "A different reason." })],
    ["time", (input) => ({ ...input, confirmedAt: "2026-07-28T11:01:00.000Z" })],
    ["company id", (input) => ({ ...input, companyId: "company_other" })],
    ["company name", (input) => ({ ...input, companyName: "Company other", memoryBundle: undefined })],
    ["status", (input) => ({ ...input, status: "passed", memoryBundle: undefined })],
    ["deal", (input) => ({ ...input, dealId: "deal_other", memoryBundle: undefined })],
  ];
  for (const [label, change] of changes) {
    const sources = createMemorySourceRegistry();
    const registry = createMemoryDealRegistry({ sourceRegistry: sources });
    const input = await assignment(sources, {
      workspaceId: "workspace_one",
      dealId: "deal_one",
      sourceId: "source_one",
      requestId: `request_${label}`,
    });
    await registry.confirmSourceAssignment(input);
    await assert.rejects(
      registry.confirmSourceAssignment(change(input)),
      /request.*different|fingerprint/i,
      label,
    );
  }
});

test("source revision fingerprints are SHA-256 over canonical UTF-8 ordering", () => {
  const ids = ["a,b", "a", "B", "é", "e\u0301", "中"];
  assert.equal(
    sourceRevisionFingerprint(ids),
    "sha256:0385ed119273e8847094485994e6df1d410c8909df4306cd9b77ee092e7d7cb3",
  );
});

test("active assignment supersession updates the fingerprint deterministically", async () => {
  const sources = createMemorySourceRegistry();
  const registry = createMemoryDealRegistry({ sourceRegistry: sources });
  const initialInput = await assignment(sources, {
    workspaceId: "workspace_one",
    dealId: "deal_one",
    sourceId: "source_one",
  });
  const first = await registry.confirmSourceAssignment(initialInput);
  const secondRevision = await sources.appendRevision({
    ...revisionInput(
      "workspace_one",
      "source_one",
      "revision_two",
      "hash_two",
    ),
    supersedesRevisionId: first.sourceRevision.id,
  });

  const confirmed = await registry.confirmSourceAssignment({
    ...initialInput,
    requestId: "request:deal_one:revision:2",
    sourceRevisionId: secondRevision.id,
    confirmedAt: "2026-07-28T12:00:00.000Z",
  });

  assert.deepEqual(confirmed.deal.activeSourceRevisionIds, [secondRevision.id]);
  assert.equal(
    confirmed.deal.activeSourceRevisionFingerprint,
    sourceRevisionFingerprint([secondRevision.id]),
  );
  assert.equal(
    registry.inspect().assignments.filter((item) => item.supersededAt === null)
      .length,
    1,
  );
});

test("assignment supersession accepts equal/later instants and rejects backdating atomically", async () => {
  const sources = createMemorySourceRegistry();
  const registry = createMemoryDealRegistry({ sourceRegistry: sources });
  const initialInput = await assignment(sources, {
    workspaceId: "workspace_one",
    dealId: "deal_chronology",
    sourceId: "source_chronology",
    confirmedAt: "2026-07-28T11:00:00.000Z",
  });
  const first = await registry.confirmSourceAssignment(initialInput);
  const secondRevision = await sources.appendRevision({
    ...revisionInput(
      "workspace_one",
      "source_chronology",
      "revision_chronology_2",
      "hash_chronology_2",
    ),
    supersedesRevisionId: first.sourceRevision.id,
  });
  await registry.confirmSourceAssignment({
    ...initialInput,
    requestId: "request:chronology:2",
    sourceRevisionId: secondRevision.id,
  });
  const thirdRevision = await sources.appendRevision({
    ...revisionInput(
      "workspace_one",
      "source_chronology",
      "revision_chronology_3",
      "hash_chronology_3",
    ),
    supersedesRevisionId: secondRevision.id,
  });
  await registry.confirmSourceAssignment({
    ...initialInput,
    requestId: "request:chronology:3",
    sourceRevisionId: thirdRevision.id,
    confirmedAt: "2026-07-28T12:00:00.000Z",
  });
  const fourthRevision = await sources.appendRevision({
    ...revisionInput(
      "workspace_one",
      "source_chronology",
      "revision_chronology_4",
      "hash_chronology_4",
    ),
    supersedesRevisionId: thirdRevision.id,
  });
  const before = registry.inspect();

  await assert.rejects(
    registry.confirmSourceAssignment({
      ...initialInput,
      requestId: "request:chronology:4",
      sourceRevisionId: fourthRevision.id,
      confirmedAt: "2026-07-28T10:59:59.999Z",
    }),
    /chronology|backdated|confirmation time/i,
  );
  assert.deepEqual(registry.inspect(), before);
});

test("workspace identity is mandatory and colliding Deal ids remain isolated", async () => {
  const sources = createMemorySourceRegistry();
  const registry = createMemoryDealRegistry({ sourceRegistry: sources });
  for (const workspaceId of ["workspace:a", "workspace"]) {
    await registry.confirmSourceAssignment(await assignment(sources, {
      workspaceId,
      dealId: workspaceId === "workspace:a" ? "external" : "a:external",
      sourceId: `source_${workspaceId}`,
    }));
  }

  assert.ok(
    await registry.findForWorkspace({
      workspaceId: "workspace:a",
      dealId: "external",
    }),
  );
  assert.ok(
    await registry.findForWorkspace({
      workspaceId: "workspace",
      dealId: "a:external",
    }),
  );
  assert.equal(
    await registry.findForWorkspace({
      workspaceId: "workspace_other",
      dealId: "external",
    }),
    null,
  );
  await assert.rejects(
    registry.listAnalysisEligibleBundles("  "),
    /workspace.*required/i,
  );
});

test("memory ownership rejects foreign workspace, Deal, source, and stale revision lineage", async () => {
  const sources = createMemorySourceRegistry();
  const registry = createMemoryDealRegistry({ sourceRegistry: sources });
  const input = await assignment(sources, {
    workspaceId: "workspace_one",
    dealId: "deal_one",
    sourceId: "source_one",
    memoryBundle: {
      dealId: "deal_one",
      companyName: "Company deal_one",
      status: "screening",
      facts: [{
        text: "A verified fact.",
        sources: [{
          id: "evidence_one",
          provenance: "source_document",
          title: "Source one",
          documentId: "source_one",
          page: 1,
          excerpt: "A verified fact.",
        }],
      }],
      interactions: [],
    },
  });
  const owner = {
    workspaceId: input.workspaceId,
    dealId: input.dealId,
    sourceId: "source_one",
    sourceRevisionId: input.sourceRevisionId,
  };
  await registry.confirmSourceAssignment({
    ...input,
    memoryLineage: { evidence: { evidence_one: owner }, interactions: {} },
  });
  assert.equal(
    (await registry.listAnalysisEligibleBundles("workspace_one"))[0]
      ?.facts.length,
    1,
  );

  for (const changedOwner of [
    { ...owner, workspaceId: "workspace_other" },
    { ...owner, dealId: "deal_other" },
    { ...owner, sourceId: "source_other" },
    { ...owner, sourceRevisionId: "revision_stale" },
  ]) {
    const isolated = createMemoryDealRegistry({ sourceRegistry: sources });
    await assert.rejects(
      isolated.confirmSourceAssignment({
        ...input,
        requestId: `request_${JSON.stringify(changedOwner)}`,
        memoryLineage: {
          evidence: { evidence_one: changedOwner },
          interactions: {},
        },
      }),
      /lineage|foreign|source|revision/i,
    );
  }
});

test("confirmation rejects cross-workspace revisions and conflicting retry identities", async () => {
  const sources = createMemorySourceRegistry();
  const registry = createMemoryDealRegistry({ sourceRegistry: sources });
  const input = await assignment(sources, {
    workspaceId: "workspace_one",
    dealId: "deal_one",
    sourceId: "source_one",
    requestId: "request_shared",
  });
  await registry.confirmSourceAssignment(input);

  await assert.rejects(
    registry.confirmSourceAssignment({
      ...input,
      workspaceId: "workspace_two",
      dealId: "deal_two",
      companyId: "company_two",
      companyName: "Company two",
      memoryBundle: undefined,
    }),
    /revision|workspace/i,
  );
  const otherRevision = await sources.createInitialRevision(
    revisionInput(
      "workspace_one",
      "source_two",
      "revision_other",
      "hash_other",
    ),
  );
  await assert.rejects(
    registry.confirmSourceAssignment({
      ...input,
      dealId: "deal_two",
      companyId: "company_two",
      companyName: "Company two",
      sourceRevisionId: otherRevision.id,
      memoryBundle: undefined,
    }),
    /request|different/i,
  );
});

test("preloaded registry backfill is idempotent and keeps nineteen as fixture data only", async () => {
  const sources = createMemorySourceRegistry();
  const deals = createMemoryDealRegistry({ sourceRegistry: sources });

  const first = await backfillPreloadedSourceRegistry({
    workspaceId: "workspace_demo",
    assignedByUserId: "user_demo",
    sourceRegistry: sources,
    dealRegistry: deals,
  });
  const second = await backfillPreloadedSourceRegistry({
    workspaceId: "workspace_demo",
    assignedByUserId: "user_demo",
    sourceRegistry: sources,
    dealRegistry: deals,
  });

  assert.equal(first.sourceRevisionCount, 14);
  assert.equal(first.eligibleDealCount, 19);
  assert.equal(second.sourceRevisionCount, 14);
  assert.equal(second.eligibleDealCount, 19);
  assert.equal(
    (await deals.listAnalysisEligibleBundles("workspace_demo")).length,
    19,
  );
  assert.equal(sources.inspect().revisions.length, 14);
  assert.equal(deals.inspect().assignments.length, 19);
});

test("backfill tolerates migration timestamps but rejects extractor provenance drift", async () => {
  const sources = createMemorySourceRegistry();
  const deals = createMemoryDealRegistry({ sourceRegistry: sources });
  await sources.createInitialRevision({
    ...revisionInput(
      "workspace_demo",
      "doc_7bridges",
      "source_revision_doc_7bridges_1",
      "698a582d94484808c419aab4602a72aa36612fdafebba56a690be3bea848d47a",
    ),
    objectKey:
      "private/demo-corpus/698a582d94484808c419aab4602a72aa36612fdafebba56a690be3bea848d47a/7bridges-Pitch-Deck.pdf",
    objectVersion:
      "698a582d94484808c419aab4602a72aa36612fdafebba56a690be3bea848d47a",
    extractorId: "preloaded-pdf",
    extractorVersion: "1",
    extractedAt: "2026-07-01T00:00:00.000Z",
    createdAt: "2026-07-01T00:00:00.000Z",
  });

  const result = await backfillPreloadedSourceRegistry({
    workspaceId: "workspace_demo",
    assignedByUserId: "user_demo",
    sourceRegistry: sources,
    dealRegistry: deals,
  });

  assert.equal(result.sourceRevisionCount, 14);
  assert.equal(
    (
      await sources.getRevision({
        workspaceId: "workspace_demo",
        revisionId: "source_revision_doc_7bridges_1",
      })
    )?.extractedAt,
    "2026-07-01T00:00:00.000Z",
  );

  const mismatchedSources = createMemorySourceRegistry();
  await mismatchedSources.createInitialRevision({
    ...revisionInput(
      "workspace_demo",
      "doc_7bridges",
      "source_revision_doc_7bridges_1",
      "698a582d94484808c419aab4602a72aa36612fdafebba56a690be3bea848d47a",
    ),
    objectKey:
      "private/demo-corpus/698a582d94484808c419aab4602a72aa36612fdafebba56a690be3bea848d47a/7bridges-Pitch-Deck.pdf",
    objectVersion:
      "698a582d94484808c419aab4602a72aa36612fdafebba56a690be3bea848d47a",
    extractorId: "wrong-extractor",
  });
  await assert.rejects(
    backfillPreloadedSourceRegistry({
      workspaceId: "workspace_demo",
      assignedByUserId: "user_demo",
      sourceRegistry: mismatchedSources,
      dealRegistry: createMemoryDealRegistry({ sourceRegistry: mismatchedSources }),
    }),
    /different immutable source data/i,
  );
});

test("Supabase confirmation and reads capture mandatory workspace scope", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const repository = createSupabaseDealRegistry({
    url: "https://example.supabase.co",
    serviceRoleKey: "test-service-role-key",
    fetchImpl: async (input, init = {}) => {
      requests.push({ url: String(input), init });
      if (String(input).includes("/rpc/confirm_source_assignment")) {
        return Response.json({
          deal: {
            id: "deal_one",
            workspaceId: "workspace_one",
            companyId: "company_one",
            companyName: "Company one",
            status: "screening",
            analysisEligibleAt: "2026-07-28T11:00:00.000Z",
            activeSourceRevisionFingerprint:
              sourceRevisionFingerprint(["revision_one"]),
            activeSourceRevisionIds: ["revision_one"],
          },
          sourceRevision: {
            id: "revision_one",
            workspaceId: "workspace_one",
            sourceId: "source_one",
            revision: 1,
            contentHash: "hash_one",
            objectKey: "private/workspace_one/source_one",
            objectVersion: "hash_one",
            contentType: "application/pdf",
            extractorId: "pdf-text",
            extractorVersion: "1.0.0",
            extractedAt: "2026-07-28T10:00:00.000Z",
            supersedesRevisionId: null,
            createdAt: "2026-07-28T10:00:01.000Z",
          },
          newlyEligible: true,
        });
      }
      return Response.json([]);
    },
  });

  await repository.confirmSourceAssignment({
    requestId: "request_one",
    workspaceId: "workspace_one",
    dealId: "deal_one",
    companyId: "company_one",
    companyName: "Company one",
    status: "screening",
    sourceRevisionId: "revision_one",
    assignedByUserId: "user_one",
    reason: "Confirmed ownership.",
    confirmedAt: "2026-07-28T11:00:00.000Z",
  });
  await repository.findForWorkspace({
    workspaceId: "workspace_one",
    dealId: "deal_one",
  });

  assert.equal(
    requests[0].url,
    "https://example.supabase.co/rest/v1/rpc/confirm_source_assignment",
  );
  assert.equal(
    JSON.parse(String(requests[0].init.body)).p_assignment.workspaceId,
    "workspace_one",
  );
  assert.doesNotMatch(
    requests.map((request) => request.url).join("\n"),
    /xtrace|uploaded_documents/i,
  );
  const findUrl = new URL(requests[1].url);
  assert.equal(findUrl.searchParams.get("workspace_id"), "eq.workspace_one");
  assert.equal(findUrl.searchParams.get("id"), "eq.deal_one");
});

test("Supabase captures the eligible snapshot in one RPC", async () => {
  const requests: string[] = [];
  const repository = createSupabaseDealRegistry({
    url: "https://example.supabase.co",
    serviceRoleKey: "test-service-role-key",
    fetchImpl: async (input) => {
      requests.push(String(input));
      return Response.json({
        count: 2,
        dealIds: ["deal_a", "deal_b"],
        fingerprint:
          "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      });
    },
  });
  const snapshotRepository = repository as typeof repository & {
    getAnalysisEligibleSnapshot?: (
      workspaceId: string,
    ) => Promise<{
      count: number;
      dealIds: string[];
      fingerprint: string;
    }>;
  };
  assert.equal(
    typeof snapshotRepository.getAnalysisEligibleSnapshot,
    "function",
  );
  assert.deepEqual(
    await snapshotRepository.getAnalysisEligibleSnapshot!("workspace_one"),
    {
      count: 2,
      dealIds: ["deal_a", "deal_b"],
      fingerprint:
        "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
  );
  assert.deepEqual(requests, [
    "https://example.supabase.co/rest/v1/rpc/get_analysis_eligible_snapshot",
  ]);
});

test("Supabase bundles emit the current status from the authoritative Deal row", async () => {
  const repository = createSupabaseDealRegistry({
    url: "https://example.supabase.co",
    serviceRoleKey: "test-service-role-key",
    fetchImpl: async (input) => {
      const url = String(input);
      if (url.includes("/deals?")) {
        return Response.json([{
          id: "deal_one",
          workspace_id: "workspace_one",
          company_id: "company_one",
          company_name: "Company one",
          status: "invested",
          analysis_eligible_at: "2026-07-28T11:00:00.000Z",
          active_source_revision_fingerprint:
            sourceRevisionFingerprint(["revision_one"]),
        }]);
      }
      if (url.includes("/deal_source_assignments?")) {
        return Response.json([{
          deal_id: "deal_one",
          source_id: "source_one",
          source_revision_id: "revision_one",
        }]);
      }
      return Response.json([]);
    },
  });

  assert.deepEqual(
    await repository.listAnalysisEligibleBundles("workspace_one"),
    [{
      dealId: "deal_one",
      companyName: "Company one",
      status: "invested",
      facts: [],
      interactions: [],
    }],
  );
});

test("Supabase eligible reads reject a stale active-revision fingerprint", async () => {
  const repository = createSupabaseDealRegistry({
    url: "https://example.supabase.co",
    serviceRoleKey: "test-service-role-key",
    fetchImpl: async (input) => {
      const url = String(input);
      if (url.includes("/deals?")) {
        return Response.json([{
          id: "deal_one",
          workspace_id: "workspace_one",
          company_id: "company_one",
          company_name: "Company one",
          status: "screening",
          analysis_eligible_at: "2026-07-28T11:00:00.000Z",
          active_source_revision_fingerprint: "stale",
        }]);
      }
      if (url.includes("/deal_source_assignments?")) {
        return Response.json([{
          deal_id: "deal_one",
          source_id: "source_one",
          source_revision_id: "revision_one",
        }]);
      }
      return Response.json([]);
    },
  });

  await assert.rejects(
    repository.listAnalysisEligibleBundles("workspace_one"),
    /fingerprint|active source/i,
  );
});

test("Supabase eligible reads reject stale evidence and interaction revision ownership", async () => {
  for (const table of ["source_evidence", "deal_interactions"]) {
    const repository = createSupabaseDealRegistry({
      url: "https://example.supabase.co",
      serviceRoleKey: "test-service-role-key",
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("/deals?")) {
          return Response.json([{
            id: "deal_one",
            workspace_id: "workspace_one",
            company_id: "company_one",
            company_name: "Company one",
            status: "screening",
            analysis_eligible_at: "2026-07-28T11:00:00.000Z",
            active_source_revision_fingerprint:
              sourceRevisionFingerprint(["revision_one"]),
          }]);
        }
        if (url.includes("/deal_source_assignments?")) {
          return Response.json([{
            deal_id: "deal_one",
            source_id: "source_one",
            source_revision_id: "revision_one",
          }]);
        }
        if (url.includes(`/${table}?`)) {
          return Response.json([{
            id: `${table}_one`,
            workspace_id: "workspace_one",
            deal_id: "deal_one",
            document_id: "source_one",
            source_revision_id: "revision_stale",
            provenance: table === "source_evidence"
              ? "source_document"
              : "demo_fixture",
            page: 1,
            fact: "Fact",
            excerpt: "Excerpt",
            occurred_at: "2026-07-28T10:00:00.000Z",
            meeting_summary: "Summary",
            decision_reason: "Reason",
            concerns: [],
            revisit_conditions: [],
            label: "Sample decision record",
          }]);
        }
        return Response.json([]);
      },
    });
    await assert.rejects(
      repository.listAnalysisEligibleBundles("workspace_one"),
      /inactive|stale|foreign|revision/i,
      table,
    );
  }
});
