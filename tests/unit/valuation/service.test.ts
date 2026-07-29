import assert from "node:assert/strict";
import test from "node:test";

import type { EvidencePack } from "../../../lib/contracts/evidence";
import type {
  FundPolicySnapshot,
  ResolvedUnderwritingContext,
} from "../../../lib/contracts/underwriting";
import {
  buildScenarioModel,
  validateProbabilityWeights,
} from "../../../lib/underwriting/valuation/scenarios";
import { createValuationEngine } from "../../../lib/underwriting/valuation/service";

const requiredScenarioFields = [
  "revenue_path",
  "arr_path",
  "growth",
  "gross_margin",
  "contribution_margin",
  "operating_expenses",
  "burn",
  "cash",
  "runway",
  "future_financing",
  "future_dilution",
  "exit_timing",
  "exit_method",
  "exit_multiple",
  "success_conditions",
  "failure_conditions",
  "probability",
] as const;

test("persists every required field in exactly Bear, Base, and Bull", () => {
  const model = buildScenarioModel({
    pack: evidencePack(),
    candidateRunId: "candidate_1",
    formulaPolicyVersion: "1",
    probabilityWeighted: false,
  });

  assert.deepEqual(model.scenarios.map(({ name }) => name), [
    "bear",
    "base",
    "bull",
  ]);
  for (const scenario of model.scenarios) {
    assert.deepEqual(
      scenario.inputs.map(({ field }) => field),
      requiredScenarioFields,
    );
    for (const input of scenario.inputs) {
      if (input.value === null) {
        assert.equal(input.evidenceItemId, null);
        assert.equal(input.assumptionItemId, null);
        assert.ok(input.unavailableReason && input.unavailableReason.length > 0);
      }
    }
  }

  const growth = model.scenarios[0].inputs.find(
    (input) => input.field === "growth",
  );
  assert.deepEqual(growth, {
    id: "scenario:candidate_1:bear:growth",
    scenario: "bear",
    field: "growth",
    value: "0.8",
    unit: "decimal",
    evidenceItemId: "fact_growth",
    assumptionItemId: null,
    unavailableReason: null,
  });
});

test("refuses probability weighting unless weights total exactly one", () => {
  const invalid = buildScenarioModel({
    pack: evidencePack({
      assumptions: [
        ...evidencePack().assumptions,
        assumption("prob_bear", "bear", "probability", "0.2"),
        assumption("prob_base", "base", "probability", "0.5"),
        assumption("prob_bull", "bull", "probability", "0.2"),
      ],
    }),
    candidateRunId: "candidate_invalid_probability",
    formulaPolicyVersion: "1",
    probabilityWeighted: true,
  });
  assert.deepEqual(validateProbabilityWeights(invalid), {
    status: "invalid_domain",
    total: "0.9",
  });

  const valid = buildScenarioModel({
    pack: evidencePack({
      assumptions: [
        ...evidencePack().assumptions,
        assumption("prob_bear", "bear", "probability", "0.2"),
        assumption("prob_base", "base", "probability", "0.5"),
        assumption("prob_bull", "bull", "probability", "0.3"),
      ],
    }),
    candidateRunId: "candidate_valid_probability",
    formulaPolicyVersion: "1",
    probabilityWeighted: true,
  });
  assert.deepEqual(validateProbabilityWeights(valid), {
    status: "completed",
    total: "1",
  });
});

test("evaluates pricing while refusing ownership when valuation basis is unknown", () => {
  const engine = createValuationEngine({
    now: () => new Date("2026-07-29T12:00:00.000Z"),
  });
  const result = engine.evaluate({
    pack: evidencePack(),
    context: context(),
    fundPolicy: policy(),
  });

  assert.equal(result.status, "partial");
  assert.deepEqual(result.scenarios.map(({ name, valuation }) => ({
    name,
    valuation,
  })), [
    { name: "bear", valuation: "15000000" },
    { name: "base", valuation: "20000000" },
    { name: "bull", valuation: "25000000" },
  ]);
  assert.equal(result.currentAsk, "25000000");
  assert.equal(result.pricingPremium, "0.25");
  assert.equal(result.initialOwnership, null);
  assert.equal(result.postDilutionOwnership, null);
  assert.ok(result.blockerCodes.includes("valuation_basis_unknown"));
  assert.ok(!("netFundMoic" in result));
  assert.ok(!("netFundIrr" in result));
});

test("wires all six formula versions for a supported pre-money preferred round", () => {
  const pack = evidencePack();
  pack.facts = pack.facts.map((fact) =>
    fact.field === "reported_valuation"
      ? { ...fact, value: "18000000" }
      : fact.field === "reported_valuation_basis"
        ? { ...fact, value: "pre_money" }
        : fact
  );
  const result = createValuationEngine({
    now: () => new Date("2026-07-29T12:00:00.000Z"),
  }).evaluate({
    pack,
    context: context(),
    fundPolicy: policy(),
  });

  assert.equal(result.status, "completed");
  assert.equal(result.initialOwnership, "0.1");
  assert.equal(result.postDilutionOwnership, "0.05");
  assert.equal(result.grossMoic, "2.5");
  assert.ok(result.grossIrr);
  for (const formulaId of [
    "market_comps_v1",
    "venture_return_method_v1",
    "simple_pre_post_ownership_v1",
    "future_dilution_v1",
    "gross_deal_moic_v1",
    "annualized_gross_irr_v1",
  ]) {
    assert.ok(
      result.calculationIds.some((id) => id.includes(formulaId)),
      `${formulaId} calculation must be included`,
    );
  }
});

function evidencePack(
  overrides: Partial<EvidencePack> = {},
): EvidencePack {
  return {
    id: "pack_1",
    version: 1,
    workspaceId: "workspace_1",
    dealId: "deal_1",
    asOfDate: "2026-07-29",
    sourceRevisionIds: ["revision_1"],
    facts: [
      {
        id: "fact_current_ask",
        analysisType: "fact",
        provenanceOrigin: "management",
        field: "reported_valuation",
        value: "25000000",
        unit: "currency",
        currency: "USD",
        periodStart: null,
        periodEnd: null,
        publishedAt: null,
        eventAt: null,
        retrievedAt: "2026-07-29T10:00:00.000Z",
        sourceRevisionId: "revision_1",
        locator: {
          kind: "text_range",
          start: 0,
          end: 10,
          excerpt: "$25m valuation",
        },
        sourceRole: "management",
        assertionStatus: "reported",
        verificationMethod: null,
        freshness: "current",
        acceptedForGate: true,
      },
      {
        id: "fact_valuation_basis",
        analysisType: "fact",
        provenanceOrigin: "management",
        field: "reported_valuation_basis",
        value: "reported_unspecified",
        unit: null,
        currency: null,
        periodStart: null,
        periodEnd: null,
        publishedAt: null,
        eventAt: null,
        retrievedAt: "2026-07-29T10:00:00.000Z",
        sourceRevisionId: "revision_1",
        locator: {
          kind: "text_range",
          start: 0,
          end: 10,
          excerpt: "$25m valuation",
        },
        sourceRole: "management",
        assertionStatus: "reported",
        verificationMethod: null,
        freshness: "current",
        acceptedForGate: true,
      },
      {
        id: "fact_growth",
        analysisType: "fact",
        provenanceOrigin: "uploaded_document",
        field: "growth",
        value: "0.8",
        unit: "decimal",
        currency: null,
        periodStart: "2025-01-01",
        periodEnd: "2025-12-31",
        publishedAt: null,
        eventAt: null,
        retrievedAt: "2026-07-29T10:00:00.000Z",
        sourceRevisionId: "revision_1",
        locator: {
          kind: "text_range",
          start: 10,
          end: 20,
          excerpt: "80% growth",
        },
        sourceRole: "management",
        assertionStatus: "reported",
        verificationMethod: null,
        freshness: "current",
        acceptedForGate: true,
      },
    ],
    assumptions: [
      assumption(
        "benchmark_seed",
        "all",
        "compatible_benchmark_value",
        "20000000",
      ),
      assumption("exit_arr_base", "base", "arr_path", "20000000"),
      assumption("exit_multiple_base", "base", "exit_multiple", "5"),
    ],
    conflicts: [],
    coverage: {
      minimumModelInputsComplete: false,
      criticalEvidenceComplete: false,
      missingFieldIds: [],
      blockingConflictIds: [],
      decisionCeiling: "Advance",
      underwritingStatus: "available",
      reasonCodes: [],
    },
    createdAt: "2026-07-29T10:05:00.000Z",
    ...overrides,
  };
}

function assumption(
  id: string,
  scenario: "bear" | "base" | "bull" | "all",
  field: string,
  value: string,
): EvidencePack["assumptions"][number] {
  return {
    id,
    analysisType: "assumption",
    provenanceOrigin: field === "compatible_benchmark_value"
      ? "benchmark"
      : "recommended_policy",
    scenario,
    field,
    value,
    unit: field === "probability" ? "decimal" : null,
    rationale: `Explicit ${field} input`,
    inputRefIds: [],
    sensitivity: "medium",
    requiresConfirmation: false,
  };
}

function context(): ResolvedUnderwritingContext {
  return {
    id: "context_seed_saas_us",
    contextVersion: "1",
    stage: "seed",
    businessModel: "b2b_saas",
    geography: "us",
    securityType: "preferred",
    asOfDate: "2026-07-29",
    criticalEvidenceProfileId: "critical_seed",
    benchmarkPackId: "benchmark_pack_seed",
    benchmarkCompatibility: "exact",
    valuationMethodPolicyId: "valuation_policy_1",
    decisionPolicyId: "decision_policy_1",
    frameworkPackId: "framework_pack_1",
  };
}

function policy(): FundPolicySnapshot {
  return {
    id: "policy_1",
    workspaceId: "workspace_1",
    version: 1,
    source: "recommended_policy",
    values: {
      initialCheckMax: "2000000",
      acceptableFutureDilution: "0.5",
      scenarioPriceMultipliers: {
        bear: "0.75",
        base: "1",
        bull: "1.25",
      },
      returnTargets: {
        seed: {
          grossMoic: "5",
          grossIrr: "0.2228445449938519",
          horizonYears: "8",
        },
      },
      probabilityWeighted: false,
    },
    createdByUserId: null,
    createdAt: "2026-07-29T09:00:00.000Z",
  };
}
