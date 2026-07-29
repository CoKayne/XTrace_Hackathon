import assert from "node:assert/strict";
import test from "node:test";

import {
  createMemoryUnderwritingReferencesRepository,
  createSupabaseUnderwritingReferencesRepository,
} from "../../db/repositories/underwriting-references";
import { BALANCED_POLICY_VALUES } from "../../seed/underwriting/balanced-policy-v1";
import {
  SYNTHETIC_FRAMEWORK_PACK_ID,
} from "../../seed/underwriting/framework-pack-v1";

test("a new workspace receives an immutable Balanced recommended policy", async () => {
  const repository = createMemoryUnderwritingReferencesRepository({
    now: () => new Date("2026-07-29T18:00:00.000Z"),
  });

  const first = await repository.activeFundPolicy("workspace_one");
  assert.equal(first.version, 1);
  assert.equal(first.source, "recommended_policy");
  assert.deepEqual(first.values, BALANCED_POLICY_VALUES);

  first.values.riskPreference = "mutated";
  const reread = await repository.activeFundPolicy("workspace_one");
  assert.equal(reread.values.riskPreference, "balanced");
});

test("custom policy, recommended overwrite diff, and restore each append a version", async () => {
  const repository = createMemoryUnderwritingReferencesRepository({
    now: () => new Date("2026-07-29T18:00:00.000Z"),
  });
  const balanced = await repository.activeFundPolicy("workspace_one");
  const customValues = structuredClone(BALANCED_POLICY_VALUES);
  customValues.riskPreference = "conservative";
  customValues.initialCheckMax = "5000000";

  const custom = await repository.saveCustomPolicy({
    workspaceId: "workspace_one",
    actorId: "user_owner",
    expectedActiveVersionId: balanced.id,
    values: customValues,
  });
  assert.equal(custom.version, 2);
  assert.equal(custom.source, "user_custom");

  const reapplied = await repository.applyBalancedDefaults({
    workspaceId: "workspace_one",
    actorId: "user_owner",
    expectedActiveVersionId: custom.id,
  });
  assert.equal(reapplied.snapshot.version, 3);
  assert.deepEqual(reapplied.overwrittenDiff, [
    {
      field: "initialCheckMax",
      previousValue: "5000000",
      recommendedValue: "8000000",
      source: "recommended_policy",
    },
    {
      field: "riskPreference",
      previousValue: "conservative",
      recommendedValue: "balanced",
      source: "recommended_policy",
    },
  ]);

  const restored = await repository.restorePolicyVersion({
    workspaceId: "workspace_one",
    actorId: "user_owner",
    versionId: custom.id,
  });
  assert.equal(restored.version, 4);
  assert.equal(restored.source, "user_custom");
  assert.deepEqual(restored.values, customValues);
  assert.deepEqual(
    (await repository.listFundPolicyVersions("workspace_one")).map(
      (snapshot) => snapshot.version,
    ),
    [4, 3, 2, 1],
  );
});

test("four Slice-1 profiles resolve US and Global requests without borrowing a benchmark", async () => {
  const repository = createMemoryUnderwritingReferencesRepository();

  const seedSaas = await repository.resolveContext({
    stage: "seed",
    businessModel: "b2b_saas",
    geography: "us",
    securityType: "preferred",
    asOfDate: "2026-07-29",
  });
  const seriesAi = await repository.resolveContext({
    stage: "series_a",
    businessModel: "enterprise_ai",
    geography: "global",
    securityType: "preferred",
    asOfDate: "2026-07-29",
  });

  assert.equal(seedSaas.kind, "resolved");
  assert.equal(seriesAi.kind, "resolved");
  if (seedSaas.kind !== "resolved" || seriesAi.kind !== "resolved") {
    assert.fail("Supported Slice-1 contexts must resolve");
  }
  assert.notEqual(
    seedSaas.value.criticalEvidenceProfileId,
    seriesAi.value.criticalEvidenceProfileId,
  );
  assert.equal(seedSaas.value.benchmarkCompatibility, "exact");
  assert.equal(seriesAi.value.benchmarkCompatibility, "unavailable");
  assert.equal(seriesAi.value.benchmarkPackId, null);
  assert.equal(seedSaas.value.frameworkPackId, SYNTHETIC_FRAMEWORK_PACK_ID);

  const unsupported = await repository.resolveContext({
    stage: "pre_seed",
    businessModel: "marketplace",
    geography: "us",
    securityType: "safe",
    asOfDate: "2026-07-29",
  } as never);
  assert.deepEqual(unsupported, {
    kind: "unsupported",
    reason:
      "Vertical Slice 1 supports only Seed or Series A B2B SaaS or Enterprise AI preferred-equity contexts.",
  });
});

test("the executable pack contains only published product-owned synthetic fixtures", async () => {
  const repository = createMemoryUnderwritingReferencesRepository();
  const pack = await repository.getFrameworkPack(SYNTHETIC_FRAMEWORK_PACK_ID);

  assert.ok(pack);
  assert.equal(pack.synthetic, true);
  assert.equal(pack.publicationStatus, "published");
  assert.equal(pack.cards.length, 8);
  assert.equal(
    pack.cards.every((card) =>
      card.synthetic
      && card.publicationStatus === "published"
      && card.attribution === "Product-owned synthetic fixture"
      && card.formalDecisionWeight === "0"
    ),
    true,
  );
  assert.doesNotMatch(
    JSON.stringify(pack),
    /Peter Thiel|Sequoia|Hamilton Helmer|Bessemer|Damodaran|privateBody|objectKey/i,
  );
});

test("the Supabase repository appends policy versions only through the controlled RPC", async () => {
  const requests: Array<{ url: string; method: string; body: unknown }> = [];
  const repository = createSupabaseUnderwritingReferencesRepository({
    url: "https://database.example.test",
    serviceRoleKey: "secret",
    fetchImpl: async (input, init = {}) => {
      const url = String(input);
      const method = init.method ?? "GET";
      const body = typeof init.body === "string"
        ? JSON.parse(init.body)
        : null;
      requests.push({ url, method, body });
      if (url.includes("/rpc/activate_fund_policy_version")) {
        return Response.json({
          id: "fund_policy:workspace_one:v2",
          workspaceId: "workspace_one",
          version: 2,
          source: "user_custom",
          values: body.p_request.values,
          createdByUserId: "user_owner",
          createdAt: "2026-07-29T18:00:00.000Z",
        });
      }
      return Response.json([]);
    },
  });

  await repository.saveCustomPolicy({
    workspaceId: "workspace_one",
    actorId: "user_owner",
    expectedActiveVersionId: "fund_policy:workspace_one:v1",
    values: BALANCED_POLICY_VALUES,
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.method, "POST");
  assert.match(requests[0]?.url ?? "", /rpc\/activate_fund_policy_version$/);
  assert.deepEqual(requests[0]?.body, {
    p_request: {
      workspaceId: "workspace_one",
      actorId: "user_owner",
      expectedActiveVersionId: "fund_policy:workspace_one:v1",
      action: "custom",
      values: BALANCED_POLICY_VALUES,
    },
  });
});

test("the Supabase public framework projection excludes non-published cards and private source fields", async () => {
  const repository = createSupabaseUnderwritingReferencesRepository({
    url: "https://database.example.test",
    serviceRoleKey: "secret",
    fetchImpl: async (input) => {
      const url = String(input);
      if (url.includes("/framework_packs?")) {
        return Response.json([{
          id: SYNTHETIC_FRAMEWORK_PACK_ID,
          version: "1",
          title: "Synthetic pack",
          synthetic: true,
          publication_status: "published",
        }]);
      }
      return Response.json([
        {
          position: 1,
          framework_cards: {
            id: "published_card",
            version: "1",
            title: "Published",
            synthetic: true,
            publication_status: "published",
            attribution: "Product-owned synthetic fixture",
            approved_neutral_paraphrase: "Safe public summary.",
            locator: "synthetic://framework/1",
            limitations: ["Synthetic."],
            rights_status: "product_owned_synthetic",
            formal_decision_weight: "0",
            private_body: "must never leave the platform boundary",
          },
        },
        {
          position: 2,
          framework_cards: {
            id: "draft_card",
            version: "1",
            title: "Draft",
            synthetic: true,
            publication_status: "draft",
            attribution: "Product-owned synthetic fixture",
            approved_neutral_paraphrase: "Not executable.",
            locator: "synthetic://framework/2",
            limitations: [],
            rights_status: "product_owned_synthetic",
            formal_decision_weight: "0",
          },
        },
      ]);
    },
  });

  const pack = await repository.getFrameworkPack(
    SYNTHETIC_FRAMEWORK_PACK_ID,
  );
  assert.ok(pack);
  assert.deepEqual(pack.cards.map((card) => card.id), ["published_card"]);
  assert.doesNotMatch(JSON.stringify(pack), /private_body|platform boundary/i);
});

test("Supabase context resolution stays pinned to the same v1 profile as memory when v2 exists", async () => {
  let requestedUrl = "";
  const input = {
    stage: "seed" as const,
    businessModel: "b2b_saas" as const,
    geography: "us" as const,
    securityType: "preferred" as const,
    asOfDate: "2026-07-29",
  };
  const repository = createSupabaseUnderwritingReferencesRepository({
    url: "https://database.example.test",
    serviceRoleKey: "secret",
    fetchImpl: async (request) => {
      requestedUrl = String(request);
      return Response.json([
        {
          id: "underwriting_context_seed_b2b_saas_v2",
          context_version: "2",
          stage: "seed",
          business_model: "b2b_saas",
          critical_evidence_profile_id: "critical_evidence_seed_b2b_saas_v2",
          us_benchmark_pack_id: "benchmark_pack_synthetic_us_software_v2",
          us_benchmark_compatibility: "broad_compatible",
          global_benchmark_compatibility: "unavailable",
          valuation_method_policy_id: "valuation_method_seed_b2b_saas_v2",
          decision_policy_id: "decision_policy_seed_b2b_saas_v2",
          framework_pack_id: "framework_pack_synthetic_universal_saas_ai_v2",
          publication_status: "published",
        },
        {
          id: "underwriting_context_seed_b2b_saas_v1",
          context_version: "1",
          stage: "seed",
          business_model: "b2b_saas",
          critical_evidence_profile_id: "critical_evidence_seed_b2b_saas_v1",
          us_benchmark_pack_id: "benchmark_pack_synthetic_us_software_v1",
          us_benchmark_compatibility: "exact",
          global_benchmark_compatibility: "unavailable",
          valuation_method_policy_id: "valuation_method_seed_b2b_saas_v1",
          decision_policy_id: "decision_policy_seed_b2b_saas_v1",
          framework_pack_id: SYNTHETIC_FRAMEWORK_PACK_ID,
          publication_status: "published",
        },
      ]);
    },
  });

  const [supabase, memory] = await Promise.all([
    repository.resolveContext(input),
    createMemoryUnderwritingReferencesRepository().resolveContext(input),
  ]);

  assert.deepEqual(supabase, memory);
  assert.match(
    requestedUrl,
    /id=eq\.underwriting_context_seed_b2b_saas_v1/,
  );
  assert.match(requestedUrl, /context_version=eq\.1/);
});
