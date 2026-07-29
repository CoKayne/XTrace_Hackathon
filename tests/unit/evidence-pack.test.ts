import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryEvidencePacksRepository } from "../../db/repositories/evidence-packs";
import { createMemorySourceRegistry } from "../../db/repositories/source-registry";
import type { ResolvedUnderwritingContext } from "../../lib/contracts/underwriting";
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
