import assert from "node:assert/strict";
import test from "node:test";

import { GET as listDrafts } from "../../app/api/action-drafts/route";
import { PATCH as updateDraft } from "../../app/api/action-drafts/[id]/route";
import {
  createMemoryUnderwritingArtifactsRepository,
  createSupabaseUnderwritingArtifactsRepository,
  type CandidateArtifactBundle,
} from "../../db/repositories/underwriting-artifacts";
import type { RouteDependencies } from "../../lib/api/route-dependencies";

const WORKSPACE_ID = "workspace_drafts";
const CANDIDATE_RUN_ID = "candidate_drafts";
const DRAFT_ID = "draft_email";

function productDependencies(
  artifacts: ReturnType<typeof createMemoryUnderwritingArtifactsRepository>,
  workspaceId = WORKSPACE_ID,
): RouteDependencies {
  return {
    async resolveRequestContext() {
      return {
        mode: "product",
        principal: { userId: "user_drafts", email: "user@example.test" },
        workspaceId,
        role: "associate",
        permissions: {
          readWorkspace: true,
          readPrivateSources: true,
          mutateSources: false,
          managePolicy: false,
          administerFrameworks: false,
        },
      };
    },
    underwritingArtifacts: artifacts,
  };
}

function seedDraftRepository() {
  const artifacts = createMemoryUnderwritingArtifactsRepository({
    now: () => new Date("2026-07-29T13:00:00.000Z"),
  });
  artifacts.commitPrepared({
    candidateRunId: CANDIDATE_RUN_ID,
    workspaceId: WORKSPACE_ID,
    dealId: "deal_drafts",
    candidateAnalysisFingerprint: `sha256:${"d".repeat(64)}`,
    actionDrafts: [{
      id: DRAFT_ID,
      workspaceId: WORKSPACE_ID,
      candidateRunId: CANDIDATE_RUN_ID,
      channel: "email",
      audienceType: "founder",
      body: "Original source-grounded body.",
      createdAt: "2026-07-29T12:00:00.000Z",
      updatedAt: "2026-07-29T12:00:00.000Z",
    }],
  } as CandidateArtifactBundle);
  return artifacts;
}

test("action draft list is candidate- and organization-scoped", async () => {
  const artifacts = seedDraftRepository();
  const response = await listDrafts(
    new Request(
      `https://vsee.test/api/action-drafts?candidateRunId=${CANDIDATE_RUN_ID}`,
    ),
    undefined,
    productDependencies(artifacts),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(
    (await response.json() as { data: unknown[] }).data,
    [{
      id: DRAFT_ID,
      candidateRunId: CANDIDATE_RUN_ID,
      channel: "email",
      audienceType: "founder",
      body: "Original source-grounded body.",
      createdAt: "2026-07-29T12:00:00.000Z",
      updatedAt: "2026-07-29T12:00:00.000Z",
    }],
  );

  const foreign = await listDrafts(
    new Request(
      `https://vsee.test/api/action-drafts?candidateRunId=${CANDIDATE_RUN_ID}`,
    ),
    undefined,
    productDependencies(artifacts, "workspace_foreign"),
  );
  assert.deepEqual((await foreign.json() as { data: unknown[] }).data, []);
});

test("PATCH replaces only the current draft body on the same identity", async () => {
  const artifacts = seedDraftRepository();
  const response = await updateDraft(
    new Request(`https://vsee.test/api/action-drafts/${DRAFT_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "Revised source-grounded body." }),
    }),
    { params: Promise.resolve({ id: DRAFT_ID }) },
    productDependencies(artifacts),
  );

  assert.equal(response.status, 200);
  assert.deepEqual((await response.json() as { data: unknown }).data, {
    id: DRAFT_ID,
    candidateRunId: CANDIDATE_RUN_ID,
    channel: "email",
    audienceType: "founder",
    body: "Revised source-grounded body.",
    createdAt: "2026-07-29T12:00:00.000Z",
    updatedAt: "2026-07-29T13:00:00.000Z",
  });
  const [persisted] = await artifacts.listActionDrafts({
    workspaceId: WORKSPACE_ID,
    candidateRunId: CANDIDATE_RUN_ID,
  });
  assert.deepEqual(persisted, {
    id: DRAFT_ID,
    workspaceId: WORKSPACE_ID,
    candidateRunId: CANDIDATE_RUN_ID,
    channel: "email",
    audienceType: "founder",
    body: "Revised source-grounded body.",
    createdAt: "2026-07-29T12:00:00.000Z",
    updatedAt: "2026-07-29T13:00:00.000Z",
  });
  assert.equal(
    (await artifacts.listActionDrafts({
      workspaceId: WORKSPACE_ID,
      candidateRunId: CANDIDATE_RUN_ID,
    })).length,
    1,
  );
});

test("PATCH rejects attempts to replace audience, channel, association, or lineage", async () => {
  const artifacts = seedDraftRepository();
  const response = await updateDraft(
    new Request(`https://vsee.test/api/action-drafts/${DRAFT_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        body: "Attempted rewrite",
        channel: "linkedin",
        audienceType: "customer",
        candidateRunId: "candidate_other",
        sourceRevisionIds: ["revision_other"],
      }),
    }),
    { params: Promise.resolve({ id: DRAFT_ID }) },
    productDependencies(artifacts),
  );
  assert.equal(response.status, 400);
  assert.equal(
    (await artifacts.listActionDrafts({
      workspaceId: WORKSPACE_ID,
      candidateRunId: CANDIDATE_RUN_ID,
    }))[0].body,
    "Original source-grounded body.",
  );
});

test("public demo is read-only and cannot PATCH a draft", async () => {
  const artifacts = seedDraftRepository();
  const response = await updateDraft(
    new Request(`https://vsee.test/api/action-drafts/${DRAFT_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "Demo mutation" }),
    }),
    { params: Promise.resolve({ id: DRAFT_ID }) },
    {
      async resolveRequestContext() {
        return {
          mode: "public_demo",
          principal: null,
          workspaceId: "workspace_demo",
          role: "demo",
          permissions: {
            readWorkspace: true,
            readPrivateSources: false,
            mutateSources: false,
            managePolicy: false,
            administerFrameworks: false,
          },
        };
      },
      underwritingArtifacts: artifacts,
    },
  );
  assert.equal(response.status, 403);
});

test("PostgreSQL draft replacement uses the controlled RPC and no direct table PATCH", async () => {
  const requests: Array<{ url: URL; init: RequestInit }> = [];
  const repository = createSupabaseUnderwritingArtifactsRepository({
    url: "https://example.supabase.co",
    serviceRoleKey: "service-role",
    fetchImpl: async (input, init = {}) => {
      requests.push({ url: new URL(String(input)), init });
      return Response.json([{
        id: DRAFT_ID,
        workspaceId: WORKSPACE_ID,
        candidateRunId: CANDIDATE_RUN_ID,
        channel: "email",
        audienceType: "founder",
        body: "Controlled body",
        createdAt: "2026-07-29T12:00:00.000Z",
        updatedAt: "2026-07-29T13:00:00.000Z",
      }]);
    },
  });

  await repository.replaceActionDraftBody({
    workspaceId: WORKSPACE_ID,
    draftId: DRAFT_ID,
    body: "Controlled body",
  });
  assert.equal(requests.length, 1);
  assert.equal(
    requests[0].url.pathname,
    "/rest/v1/rpc/replace_action_draft_body",
  );
  assert.equal(requests[0].init.method, "POST");
  assert.deepEqual(JSON.parse(String(requests[0].init.body)), {
    p_workspace_id: WORKSPACE_ID,
    p_draft_id: DRAFT_ID,
    p_body: "Controlled body",
  });
  assert.equal(
    requests.some(({ url, init }) =>
      url.pathname.endsWith("/action_drafts") && init.method === "PATCH"
    ),
    false,
  );
});
