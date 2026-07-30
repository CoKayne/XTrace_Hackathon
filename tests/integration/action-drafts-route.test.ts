import assert from "node:assert/strict";
import test from "node:test";

import { saveActionDraftBody } from "../../app/action-draft-dialog";
import { GET as listDrafts } from "../../app/api/action-drafts/route";
import { PATCH as updateDraft } from "../../app/api/action-drafts/[id]/route";
import {
  createMemoryUnderwritingArtifactsRepository,
  createSupabaseUnderwritingArtifactsRepository,
  type CandidateArtifactBundle,
} from "../../db/repositories/underwriting-artifacts";
import type { RouteDependencies } from "../../lib/api/route-dependencies";
import type { PublicActionDraft } from "../../lib/underwriting/read-model";

const WORKSPACE_ID = "workspace_drafts";
const CANDIDATE_RUN_ID = "candidate_drafts";
const DRAFT_ID = "draft_email";
const LEGACY_MEMO_ID = "draft_legacy_memo";
const LEGACY_MEMO_BODY = [
  "INTERNAL UNDERWRITING ACTION MEMO",
  "  Limitations: Partner-authored preface must survive.",
  "",
  "EXPERIMENTAL ADVISORY OPINIONS — DRAFT ONLY",
  "- Pack: Legacy public advisory pack",
  "  Applicability: applicable; advisory conclusion: supportive",
  "  Product-synthesis notice: Private generated notice.",
  "  Limitations: Private generated limitation.",
  "  Component qualifications and limitations:",
  "    - PT-01: Private generated review issue.",
  "",
  "INDEPENDENT ADVISORY CONFLICTS",
  "Unavailable",
  "",
  "ADVISORY DILIGENCE REQUESTS",
  "- Address advisory limitation [Legacy pack]: Private generated limitation.",
  "- Resolve advisory unknown [Legacy pack]: Public generated question.",
  "",
  "  Limitations: Partner-authored appendix must survive.",
  "- Address advisory limitation [Partner note]: Partner-authored follow-up must survive.",
].join("\n");
const ORDINARY_EMAIL_WITH_MATCHING_LINES = [
  "Subject: Partner-authored limitations",
  "  Limitations: Keep this email line.",
  "- Address advisory limitation [Partner note]: Keep this email request.",
].join("\n");

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

function seedLegacyDraftRepository() {
  const artifacts = createMemoryUnderwritingArtifactsRepository({
    now: () => new Date("2026-07-29T13:00:00.000Z"),
  });
  artifacts.commitPrepared({
    candidateRunId: CANDIDATE_RUN_ID,
    workspaceId: WORKSPACE_ID,
    dealId: "deal_drafts",
    candidateAnalysisFingerprint: `sha256:${"e".repeat(64)}`,
    actionDrafts: [
      {
        id: LEGACY_MEMO_ID,
        workspaceId: WORKSPACE_ID,
        candidateRunId: CANDIDATE_RUN_ID,
        channel: "internal_memo",
        audienceType: "internal",
        body: LEGACY_MEMO_BODY,
        createdAt: "2026-07-29T12:00:00.000Z",
        updatedAt: "2026-07-29T12:00:00.000Z",
      },
      {
        id: DRAFT_ID,
        workspaceId: WORKSPACE_ID,
        candidateRunId: CANDIDATE_RUN_ID,
        channel: "email",
        audienceType: "founder",
        body: ORDINARY_EMAIL_WITH_MATCHING_LINES,
        createdAt: "2026-07-29T12:00:00.000Z",
        updatedAt: "2026-07-29T12:00:00.000Z",
      },
    ],
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

test("GET and PATCH sanitize only the exact legacy generated advisory spans", async () => {
  const artifacts = seedLegacyDraftRepository();
  const readPublicDrafts = async () => {
    const response = await listDrafts(
      new Request(
        `https://vsee.test/api/action-drafts?candidateRunId=${CANDIDATE_RUN_ID}`,
      ),
      undefined,
      productDependencies(artifacts),
    );
    assert.equal(response.status, 200);
    return (await response.json() as {
      data: PublicActionDraft[];
    }).data;
  };

  const initialDrafts = await readPublicDrafts();
  const initialMemo = initialDrafts.find(({ id }) => id === LEGACY_MEMO_ID);
  const initialEmail = initialDrafts.find(({ id }) => id === DRAFT_ID);
  assert.ok(initialMemo);
  assert.ok(initialEmail);
  assert.equal(initialEmail.body, ORDINARY_EMAIL_WITH_MATCHING_LINES);
  assert.match(initialMemo.body, /Partner-authored preface must survive/);
  assert.match(initialMemo.body, /Partner-authored appendix must survive/);
  assert.match(initialMemo.body, /Partner-authored follow-up must survive/);
  assert.match(initialMemo.body, /Public generated question/);
  assert.doesNotMatch(initialMemo.body, /Private generated notice/);
  assert.doesNotMatch(initialMemo.body, /Private generated limitation/);
  assert.doesNotMatch(initialMemo.body, /Private generated review issue/);

  const revisedBody = LEGACY_MEMO_BODY.replace(
    "advisory conclusion: supportive",
    "advisory conclusion: mixed after partner edit",
  );
  const patchResponse = await updateDraft(
    new Request(`https://vsee.test/api/action-drafts/${LEGACY_MEMO_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: revisedBody }),
    }),
    { params: Promise.resolve({ id: LEGACY_MEMO_ID }) },
    productDependencies(artifacts),
  );
  assert.equal(patchResponse.status, 200);
  const patched = (await patchResponse.json() as {
    data: PublicActionDraft;
  }).data;
  assert.match(patched.body, /mixed after partner edit/);
  assert.match(patched.body, /Partner-authored preface must survive/);
  assert.match(patched.body, /Partner-authored appendix must survive/);
  assert.match(patched.body, /Partner-authored follow-up must survive/);
  assert.doesNotMatch(patched.body, /Private generated limitation/);

  const persisted = (await artifacts.listActionDrafts({
    workspaceId: WORKSPACE_ID,
    candidateRunId: CANDIDATE_RUN_ID,
  })).find(({ id }) => id === LEGACY_MEMO_ID);
  assert.equal(persisted?.body, revisedBody);

  const rereadMemo = (await readPublicDrafts()).find(({ id }) =>
    id === LEGACY_MEMO_ID
  );
  assert.ok(rereadMemo);
  assert.equal(rereadMemo.body, patched.body);
});

test("the draft Save interaction PATCHes the current identity and persists only its body", async () => {
  const artifacts = seedDraftRepository();
  let requestedUrl = "";
  let requestedInit: RequestInit | undefined;
  const updated = await saveActionDraftBody({
    draftId: DRAFT_ID,
    body: "Saved through the editor interaction.",
    request: async (url, init) => {
      requestedUrl = url;
      requestedInit = init;
      const response = await updateDraft(
        new Request(`https://vsee.test${url}`, {
          ...init,
          headers: { "content-type": "application/json" },
        }),
        { params: Promise.resolve({ id: DRAFT_ID }) },
        productDependencies(artifacts),
      );
      assert.equal(response.status, 200);
      return (await response.json() as { data: PublicActionDraft }).data;
    },
  });

  assert.equal(requestedUrl, `/api/action-drafts/${DRAFT_ID}`);
  assert.equal(requestedInit?.method, "PATCH");
  assert.deepEqual(JSON.parse(String(requestedInit?.body)), {
    body: "Saved through the editor interaction.",
  });
  assert.deepEqual(updated, {
    id: DRAFT_ID,
    candidateRunId: CANDIDATE_RUN_ID,
    channel: "email",
    audienceType: "founder",
    body: "Saved through the editor interaction.",
    createdAt: "2026-07-29T12:00:00.000Z",
    updatedAt: "2026-07-29T13:00:00.000Z",
  });
  const [persisted] = await artifacts.listActionDrafts({
    workspaceId: WORKSPACE_ID,
    candidateRunId: CANDIDATE_RUN_ID,
  });
  assert.equal(persisted.id, DRAFT_ID);
  assert.equal(persisted.channel, "email");
  assert.equal(persisted.audienceType, "founder");
  assert.equal(persisted.body, "Saved through the editor interaction.");
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

test("PostgreSQL finalized-artifact listing excludes alias candidates", async () => {
  let requestedUrl = "";
  const repository = createSupabaseUnderwritingArtifactsRepository({
    url: "https://example.supabase.co",
    serviceRoleKey: "service-role",
    fetchImpl: async (input) => {
      requestedUrl = String(input);
      return Response.json([]);
    },
  });

  assert.deepEqual(await repository.listFinalizedForWorkspace({
    workspaceId: WORKSPACE_ID,
  }), []);
  const query = new URL(requestedUrl).searchParams;
  assert.equal(query.get("workspace_id"), `eq.${WORKSPACE_ID}`);
  assert.equal(query.get("status"), "in.(completed,partial)");
  assert.equal(
    query.get("artifact_source_candidate_run_id"),
    "is.null",
  );
});
