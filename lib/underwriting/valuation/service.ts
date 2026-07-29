import type {
  Assumption,
  EvidencePack,
  Fact,
} from "../../contracts/evidence";
import type {
  FundPolicySnapshot,
  ResolvedUnderwritingContext,
  ValuationEvaluation,
} from "../../contracts/underwriting";
import { multiplyDecimalStrings } from "../numbers";
import type { ValuationEngine, FormulaValueRef } from "./contracts";
import { evaluateMarketComps } from "./market-comps";
import { evaluateOwnership } from "./ownership";
import { evaluateGrossReturns } from "./returns";
import { buildScenarioModel, validateProbabilityWeights } from "./scenarios";
import { evaluateVentureMethod } from "./venture-method";

export function createValuationEngine(options: {
  now?: () => Date;
} = {}): ValuationEngine {
  return {
    evaluate(input) {
      return evaluateValuation(input, options);
    },
  };
}

function evaluateValuation(input: {
  pack: EvidencePack;
  context: ResolvedUnderwritingContext;
  fundPolicy: FundPolicySnapshot;
}, options: {
  now?: () => Date;
}): ValuationEvaluation {
  const currentAskFact = acceptedFact(
    input.pack,
    "reported_valuation",
  );
  const valuationBasis = acceptedFact(
    input.pack,
    "reported_valuation_basis",
  )?.value ?? null;
  const benchmark = assumption(
    input.pack,
    "compatible_benchmark_value",
    "all",
  );
  const multipliers = policyRecord(
    input.fundPolicy,
    "scenarioPriceMultipliers",
  );
  const market = evaluateMarketComps({
    benchmarkValue: benchmark ? assumptionRef(benchmark) : null,
    currentReportedValuation: currentAskFact ? factRef(currentAskFact) : null,
    compatibility: input.context.benchmarkCompatibility,
    stale: false,
    multipliers: {
      bear: policyRef(
        "scenarioPriceMultipliers.bear",
        stringValue(multipliers, "bear"),
      ),
      base: policyRef(
        "scenarioPriceMultipliers.base",
        stringValue(multipliers, "base"),
      ),
      bull: policyRef(
        "scenarioPriceMultipliers.bull",
        stringValue(multipliers, "bull"),
      ),
    },
  }, options);

  const scenarioModel = buildScenarioModel({
    pack: input.pack,
    candidateRunId: `valuation:${input.pack.id}`,
    formulaPolicyVersion: input.context.valuationMethodPolicyId,
    probabilityWeighted:
      input.fundPolicy.values.probabilityWeighted === true,
  });
  const probabilityStatus = validateProbabilityWeights(scenarioModel);
  const baseInputs = scenarioModel.scenarios.find(
    ({ name }) => name === "base",
  )!.inputs;
  const baseExitArr = scenarioRef(baseInputs, "arr_path");
  const baseExitMultiple = scenarioRef(baseInputs, "exit_multiple");
  const returnTarget = stageReturnTarget(
    input.fundPolicy,
    input.context.stage,
  );
  const venture = evaluateVentureMethod({
    terms: input.context.securityType === "preferred"
      ? "simple_pre_money_preferred"
      : "preferred_waterfall",
    investment: policyRef(
      "initialCheckMax",
      policyString(input.fundPolicy, "initialCheckMax"),
    ),
    targetGrossMoic: policyRef(
      `returnTargets.${input.context.stage}.grossMoic`,
      stringValue(returnTarget, "grossMoic"),
    ),
    exitArr: baseExitArr,
    exitArrMultiple: baseExitMultiple,
    futureDilutionRate: policyRef(
      "acceptableFutureDilution",
      policyString(input.fundPolicy, "acceptableFutureDilution"),
    ),
  }, options);

  let initialOwnership: string | null = null;
  let postDilutionOwnership: string | null = null;
  let grossMoic: string | null = null;
  let grossIrr: string | null = null;
  let ownershipCalculations: Array<{ id: string }> = [];
  let returnCalculations: Array<{ id: string }> = [];
  const blockerCodes = [
    ...market.blockerCodes,
    ...venture.blockerCodes,
  ];

  const investment = policyString(input.fundPolicy, "initialCheckMax");
  const dilution = policyString(
    input.fundPolicy,
    "acceptableFutureDilution",
  );
  if (
    currentAskFact
    && investment
    && valuationBasis === "pre_money"
  ) {
    const ownership = evaluateOwnership({
      investment: policyRef("initialCheckMax", investment),
      preMoney: factRef(currentAskFact),
      futureDilutionRate: policyRef(
        "acceptableFutureDilution",
        dilution,
      ),
    }, options);
    blockerCodes.push(...ownership.blockerCodes);
    ownershipCalculations = ownership.calculations;
    initialOwnership = ownership.value?.initialOwnership ?? null;
    postDilutionOwnership =
      ownership.value?.postDilutionOwnership ?? null;
    if (ownership.status === "completed") {
      const exitEquityValue = venture.value?.exitEquityValue;
      const holdingYears = stringValue(returnTarget, "horizonYears");
      if (postDilutionOwnership && exitEquityValue && holdingYears) {
        const proceeds = multiplyDecimalStrings(
          exitEquityValue,
          postDilutionOwnership,
        );
        const returns = evaluateGrossReturns({
          invested: policyRef("initialCheckMax", investment),
          proceeds: {
            itemId: "calculation:venture_return_method_v1:exitEquityValue",
            value: proceeds,
            type: "assumption",
          },
          holdingYears: policyRef(
            `returnTargets.${input.context.stage}.horizonYears`,
            holdingYears,
          ),
          lineageInputRefs: [
            baseExitArr!,
            baseExitMultiple!,
            factRef(currentAskFact),
            policyRef("acceptableFutureDilution", dilution)!,
          ],
        }, options);
        blockerCodes.push(...returns.blockerCodes);
        returnCalculations = returns.calculations;
        grossMoic = returns.value?.moic ?? null;
        grossIrr = returns.value?.irr ?? null;
      }
    }
  } else if (currentAskFact) {
    blockerCodes.push(
      valuationBasis === null
        ? "valuation_basis_missing"
        : "valuation_basis_unknown",
    );
  }

  if (
    probabilityStatus.status !== "completed"
    && probabilityStatus.status !== "not_applicable"
  ) {
    blockerCodes.push("probability_weights_invalid");
  }
  const calculationIds = [
    ...market.calculations,
    ...venture.calculations,
    ...ownershipCalculations,
    ...returnCalculations,
  ].map(({ id }) => id);
  const completedSections = [
    market.status === "completed",
    venture.status === "completed",
    initialOwnership !== null,
    grossMoic !== null,
  ].filter(Boolean).length;

  return {
    id: `valuation:${input.pack.id}`,
    status: completedSections === 0
      ? "unavailable"
      : completedSections === 4
        ? "completed"
        : "partial",
    scenarios: (["bear", "base", "bull"] as const).map((name) => ({
      name,
      valuation: market.scenarios[name],
      calculationIds: market.calculations
        .filter(({ outputField }) => outputField === `${name}_valuation`)
        .map(({ id }) => id),
    })),
    currentAsk: currentAskFact?.value ?? null,
    maximumAcceptablePreMoney:
      venture.value?.maximumAcceptablePreMoney ?? null,
    initialOwnership,
    postDilutionOwnership,
    grossMoic,
    grossIrr,
    pricingPremium: market.pricingPremium,
    calculationIds,
    blockerCodes: [...new Set(blockerCodes)],
  };
}

function acceptedFact(pack: EvidencePack, field: string): Fact | null {
  return pack.facts.find(
    (candidate) =>
      candidate.field === field
      && candidate.acceptedForGate,
  ) ?? null;
}

function assumption(
  pack: EvidencePack,
  field: string,
  scenario: Assumption["scenario"],
): Assumption | null {
  return pack.assumptions.find(
    (candidate) =>
      candidate.field === field
      && candidate.scenario === scenario,
  ) ?? null;
}

function factRef(fact: Fact): FormulaValueRef {
  return { itemId: fact.id, value: fact.value, type: "fact" };
}

function assumptionRef(value: Assumption): FormulaValueRef {
  return {
    itemId: value.id,
    value: value.value,
    type: value.provenanceOrigin === "benchmark"
      ? "benchmark"
      : "assumption",
  };
}

function policyRef(
  itemId: string,
  value: string | null,
): FormulaValueRef | null {
  return value === null
    ? null
    : { itemId: `policy:${itemId}`, value, type: "policy" };
}

function scenarioRef(
  inputs: ReturnType<typeof buildScenarioModel>["scenarios"][number]["inputs"],
  field: "arr_path" | "exit_multiple",
): FormulaValueRef | null {
  const input = inputs.find((candidate) => candidate.field === field);
  if (!input?.value) return null;
  return {
    itemId: input.evidenceItemId ?? input.assumptionItemId!,
    value: input.value,
    type: input.evidenceItemId ? "fact" : "assumption",
  };
}

function policyString(
  policy: FundPolicySnapshot,
  key: string,
): string | null {
  const value = policy.values[key];
  return typeof value === "string" ? value : null;
}

function policyRecord(
  policy: FundPolicySnapshot,
  key: string,
): Record<string, unknown> | null {
  const value = policy.values[key];
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function stageReturnTarget(
  policy: FundPolicySnapshot,
  stage: ResolvedUnderwritingContext["stage"],
): Record<string, unknown> | null {
  const targets = policyRecord(policy, "returnTargets");
  const value = targets?.[stage];
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(
  record: Record<string, unknown> | null,
  key: string,
): string | null {
  const value = record?.[key];
  return typeof value === "string" ? value : null;
}
