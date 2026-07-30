import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryEvidencePacksRepository } from "../../db/repositories/evidence-packs";
import * as evidencePackRepositories from "../../db/repositories/evidence-packs";
import { createMemorySourceRegistry } from "../../db/repositories/source-registry";
import type {
  FundPolicySnapshot,
  ResolvedUnderwritingContext,
} from "../../lib/contracts/underwriting";
import { createEvidencePackBuilder } from "../../lib/underwriting/evidence/builder";
import {
  createContextRouter,
  type CriticalEvidenceProfile,
} from "../../lib/underwriting/router";

const context: ResolvedUnderwritingContext = {
  id: "underwriting_context_seed_b2b_saas_v1",
  contextVersion: "1",
  stage: "seed",
  businessModel: "b2b_saas",
  geography: "us",
  securityType: "preferred",
  asOfDate: "2026-07-29",
  criticalEvidenceProfileId: "critical_evidence_seed_b2b_saas_v1",
  benchmarkPackId: "benchmark_pack_synthetic_us_software_v1",
  benchmarkCompatibility: "exact",
  valuationMethodPolicyId: "valuation_method_seed_b2b_saas_v1",
  decisionPolicyId: "decision_policy_seed_b2b_saas_v1",
  frameworkPackId: "framework_pack_synthetic_universal_saas_ai_v1",
};

const profile: CriticalEvidenceProfile = {
  id: context.criticalEvidenceProfileId,
  version: "1",
  publicationStatus: "published",
  definitionFingerprint: `sha256:${"c".repeat(64)}`,
  fields: [
    {
      fieldId: "company_identity",
      critical: true,
      minimumModelInput: true,
      acceptedAssertionStatuses: ["reported", "verified"],
      acceptedFreshness: ["current"],
    },
    {
      fieldId: "reported_valuation",
      critical: true,
      minimumModelInput: false,
      acceptedAssertionStatuses: ["reported", "verified"],
      acceptedFreshness: ["current"],
    },
    {
      fieldId: "arr",
      critical: true,
      minimumModelInput: false,
      acceptedAssertionStatuses: ["reported", "verified"],
      acceptedFreshness: ["current"],
    },
  ],
};

const referenceInputs = {
  fundPolicy: {
    id: "fund_policy:workspace_1:v1",
    workspaceId: "workspace_1",
    version: 1,
    source: "recommended_policy",
    values: {
      scenarioPriceMultipliers: {
        bear: "0.75",
        base: "1",
        bull: "1.25",
      },
    },
    createdByUserId: null,
    createdAt: "2026-07-29T09:00:00.000Z",
  } satisfies FundPolicySnapshot,
  benchmark: {
    packId: context.benchmarkPackId!,
    entryId: "benchmark_entry_synthetic_seed_valuation_v1",
    version: "1",
    value: "24000000",
    currency: "USD",
    effectiveAt: "2026-07-29",
    staleAfter: "2027-01-25",
    definitionFingerprint: `sha256:${"b".repeat(64)}`,
  },
};

async function setup() {
  const sourceRegistry = createMemorySourceRegistry();
  const repository = createMemoryEvidencePacksRepository();
  for (const [index, sourceId] of ["management", "verified"].entries()) {
    await sourceRegistry.createInitialRevision({
      id: `revision_${index + 1}`,
      workspaceId: "workspace_1",
      sourceId: `source_${sourceId}`,
      contentHash: `sha256:${sourceId}`,
      objectKey: `private/${sourceId}.md`,
      objectVersion: `object:${sourceId}:v1`,
      contentType: "text/markdown",
      extractorId: "plain_text_v1",
      extractorVersion: "1",
      extractedAt: `2026-07-29T10:0${index}:00.000Z`,
      createdAt: `2026-07-29T10:0${index}:01.000Z`,
    });
  }
  const common = {
    workspaceId: "workspace_1",
    dealId: "deal_1",
    provenanceOrigin: "management" as const,
    unit: null,
    currency: null,
    periodStart: null,
    periodEnd: null,
    publishedAt: null,
    eventAt: null,
    retrievedAt: "2026-07-29T10:05:00.000Z",
    sourceRole: "management" as const,
    assertionStatus: "reported" as const,
    verificationMethod: null,
    freshness: "current" as const,
    acceptedForGate: true,
  };
  await repository.putSourceEvidence([
    {
      ...common,
      id: "fact_company",
      sourceId: "source_management",
      sourceRevisionId: "revision_1",
      field: "Company Identity",
      value: "company_1",
      locator: {
        kind: "text_range",
        start: 0,
        end: 9,
        excerpt: "Company 1",
      },
    },
    {
      ...common,
      id: "fact_valuation",
      sourceId: "source_management",
      sourceRevisionId: "revision_1",
      field: "Pre-money valuation",
      value: "$20,000,000",
      unit: "currency",
      currency: "USD",
      locator: {
        kind: "text_range",
        start: 10,
        end: 30,
        excerpt: "Pre-money $20m",
      },
    },
    {
      ...common,
      id: "fact_valuation_basis",
      sourceId: "source_management",
      sourceRevisionId: "revision_1",
      field: "Valuation basis",
      value: "pre-money",
      locator: {
        kind: "text_range",
        start: 31,
        end: 40,
        excerpt: "pre-money",
      },
    },
    {
      ...common,
      id: "fact_arr_reported",
      sourceId: "source_management",
      sourceRevisionId: "revision_1",
      field: "ARR",
      value: "$2,000,000",
      unit: "currency",
      currency: "USD",
      periodStart: "2025-01-01",
      periodEnd: "2025-12-31",
      locator: {
        kind: "text_range",
        start: 41,
        end: 50,
        excerpt: "ARR $2m",
      },
    },
    {
      ...common,
      id: "fact_arr_verified",
      sourceId: "source_verified",
      sourceRevisionId: "revision_2",
      provenanceOrigin: "public_source",
      sourceRole: "independent_third_party",
      assertionStatus: "verified",
      verificationMethod: "audited filing",
      field: "Annual recurring revenue",
      value: "$3,000,000",
      unit: "currency",
      currency: "USD",
      periodStart: "2025-01-01",
      periodEnd: "2025-12-31",
      locator: {
        kind: "text_range",
        start: 0,
        end: 9,
        excerpt: "ARR $3m",
      },
    },
  ]);
  const builder = createEvidencePackBuilder({
    repository,
    sourceRegistry,
    router: createContextRouter(),
    criticalEvidenceProfiles: [profile],
    now: () => new Date("2026-07-29T10:10:00.000Z"),
  });
  return { repository, builder };
}

test("builds one immutable pack without resolving a material ARR conflict in favor of either source", async () => {
  const { repository, builder } = await setup();
  const first = await builder.build({
    workspaceId: "workspace_1",
    dealId: "deal_1",
    asOfDate: "2026-07-29",
    sourceRevisionIds: ["revision_2", "revision_1"],
    xtraceLineage: {
      memoryIds: ["memory_1"],
      sourceRevisionIds: ["revision_1", "revision_2"],
      sourceIds: ["source_management", "source_verified"],
      fixtureIds: [],
      capturedAt: "2026-07-29T10:09:00.000Z",
    },
    context,
    ...referenceInputs,
  });
  const second = await builder.build({
    workspaceId: "workspace_1",
    dealId: "deal_1",
    asOfDate: "2026-07-29",
    sourceRevisionIds: ["revision_1", "revision_2"],
    xtraceLineage: {
      memoryIds: ["memory_1"],
      sourceRevisionIds: ["revision_2", "revision_1"],
      sourceIds: ["source_verified", "source_management"],
      fixtureIds: [],
      capturedAt: "2026-07-29T10:09:00.000Z",
    },
    context,
    ...referenceInputs,
  });

  assert.equal(first.id, second.id);
  assert.deepEqual(
    first.facts.filter(({ field }) => field === "arr").map(({ value }) => value),
    ["2000000", "3000000"],
  );
  assert.equal(first.conflicts.length, 1);
  assert.equal(first.conflicts[0]?.status, "open");
  assert.equal(first.coverage.decisionCeiling, "Advance");
  assert.equal(
    first.assumptions.some(({ field }) => field === "arr_path"),
    false,
    "an unresolved ARR conflict must not become a scenario input",
  );
  assert.equal(repository.inspect().savedPacks.length, 1);
});

test("rejects canonical evidence whose document ID does not own its revision", async () => {
  const { repository, builder } = await setup();
  await repository.putSourceEvidence([{
    id: "fact_foreign_source_tuple",
    workspaceId: "workspace_1",
    dealId: "deal_1",
    sourceId: "source_foreign",
    sourceRevisionId: "revision_1",
    provenanceOrigin: "uploaded_document",
    field: "unstructured_source_fact",
    value: "Generic prose must not cross source identity boundaries.",
    unit: null,
    currency: null,
    periodStart: null,
    periodEnd: null,
    publishedAt: null,
    eventAt: null,
    retrievedAt: "2026-07-29T10:05:00.000Z",
    locator: {
      kind: "text_range",
      start: 51,
      end: 102,
      excerpt: "Generic prose must not cross source identity boundaries.",
    },
    sourceRole: "management",
    assertionStatus: "reported",
    verificationMethod: null,
    freshness: "current",
    acceptedForGate: false,
  }]);

  await assert.rejects(builder.build({
    workspaceId: "workspace_1",
    dealId: "deal_1",
    asOfDate: "2026-07-29",
    sourceRevisionIds: ["revision_1"],
    xtraceLineage: {
      memoryIds: [],
      sourceRevisionIds: [],
      sourceIds: [],
      fixtureIds: [],
      capturedAt: "2026-07-29T10:09:00.000Z",
    },
    context,
    ...referenceInputs,
  }), /document.*revision|source.*revision/i);
});

test("emits valuation-compatible benchmark, policy multiplier, and currency-bearing ARR assumptions", async () => {
  const { repository, builder } = await setup();
  await repository.removeSourceEvidence({
    workspaceId: "workspace_1",
    evidenceId: "fact_arr_verified",
  });

  const pack = await builder.build({
    workspaceId: "workspace_1",
    dealId: "deal_1",
    asOfDate: "2026-07-29",
    sourceRevisionIds: ["revision_1"],
    xtraceLineage: {
      memoryIds: [],
      sourceRevisionIds: [],
      sourceIds: [],
      fixtureIds: [],
      capturedAt: "2026-07-29T10:09:00.000Z",
    },
    context,
    ...referenceInputs,
  });

  const benchmarkValue = pack.assumptions.find(
    ({ field }) => field === "compatible_benchmark_value",
  );
  const benchmarkExpiry = pack.assumptions.find(
    ({ field }) => field === "compatible_benchmark_stale_after",
  );
  const multipliers = pack.assumptions.filter(
    ({ field }) => field === "scenario_price_multiplier",
  );
  const arrPaths = pack.assumptions.filter(({ field }) => field === "arr_path");

  assert.equal(benchmarkValue?.provenanceOrigin, "benchmark");
  assert.equal(benchmarkValue?.unit, "USD");
  assert.deepEqual(benchmarkValue?.inputRefIds, [context.benchmarkPackId]);
  assert.equal(benchmarkExpiry?.provenanceOrigin, "benchmark");
  assert.match(benchmarkExpiry?.value ?? "", /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(
    multipliers.map(({ scenario }) => scenario).sort(),
    ["base", "bear", "bull"],
  );
  assert.equal(
    multipliers.every(
      ({ provenanceOrigin }) => provenanceOrigin === "recommended_policy",
    ),
    true,
  );
  assert.deepEqual(
    arrPaths.map(({ scenario, unit }) => [scenario, unit]).sort(),
    [["base", "USD"], ["bear", "USD"], ["bull", "USD"]],
  );
});

test("uses the pinned custom Fund Policy and selected benchmark values without Balanced defaults", async () => {
  const { repository, builder } = await setup();
  await repository.removeSourceEvidence({
    workspaceId: "workspace_1",
    evidenceId: "fact_arr_verified",
  });

  const pack = await builder.build({
    workspaceId: "workspace_1",
    dealId: "deal_1",
    asOfDate: "2026-07-29",
    sourceRevisionIds: ["revision_1"],
    xtraceLineage: {
      memoryIds: [],
      sourceRevisionIds: [],
      sourceIds: [],
      fixtureIds: [],
      capturedAt: "2026-07-29T10:09:00.000Z",
    },
    context,
    fundPolicy: {
      id: "fund_policy:workspace_1:custom-v2",
      workspaceId: "workspace_1",
      version: 2,
      source: "user_custom",
      values: {
        scenarioPriceMultipliers: {
          bear: "0.4",
          base: "0.9",
          bull: "1.7",
        },
      },
      createdByUserId: "user_1",
      createdAt: "2026-07-29T09:00:00.000Z",
    },
    benchmark: {
      packId: context.benchmarkPackId!,
      entryId: "benchmark_entry_custom_seed_valuation_v1",
      version: "1",
      value: "31500000",
      currency: "USD",
      effectiveAt: "2026-07-29",
      staleAfter: "2026-10-31",
      definitionFingerprint: `sha256:${"d".repeat(64)}`,
    },
  });

  assert.deepEqual(
    Object.fromEntries(pack.assumptions
      .filter(({ field }) => field === "scenario_price_multiplier")
      .map(({ scenario, value, provenanceOrigin, inputRefIds }) => [
        scenario,
        {
        value,
        provenanceOrigin,
        inputRefIds,
        },
      ])),
    {
      bear: {
        value: "0.4",
        provenanceOrigin: "user_custom",
        inputRefIds: ["fund_policy:workspace_1:custom-v2"],
      },
      base: {
        value: "0.9",
        provenanceOrigin: "user_custom",
        inputRefIds: ["fund_policy:workspace_1:custom-v2"],
      },
      bull: {
        value: "1.7",
        provenanceOrigin: "user_custom",
        inputRefIds: ["fund_policy:workspace_1:custom-v2"],
      },
    },
  );
  assert.equal(
    pack.assumptions.find(
      ({ field }) => field === "compatible_benchmark_value",
    )?.value,
    "31500000",
  );
  assert.equal(
    pack.assumptions.find(
      ({ field }) => field === "compatible_benchmark_stale_after",
    )?.value,
    "2026-10-31",
  );
});

test("2030 Evidence Pack build rejects a benchmark stale for its as-of date", async () => {
  const { builder } = await setup();
  await assert.rejects(
    builder.build({
      workspaceId: "workspace_1",
      dealId: "deal_1",
      asOfDate: "2030-01-01",
      sourceRevisionIds: ["revision_1"],
      xtraceLineage: {
        memoryIds: [],
        sourceRevisionIds: [],
        sourceIds: [],
        fixtureIds: [],
        capturedAt: "2026-07-29T10:09:00.000Z",
      },
      context: {
        ...context,
        id: "underwriting_context_seed_b2b_saas_v1:2030-01-01",
        asOfDate: "2030-01-01",
      },
      ...referenceInputs,
    }),
    /benchmark.*(?:as-of|stale)/i,
  );
});

test("provides a production Evidence Pack repository for exact source-evidence reads", () => {
  assert.equal(
    "createSupabaseEvidencePacksRepository" in evidencePackRepositories,
    true,
  );
});
