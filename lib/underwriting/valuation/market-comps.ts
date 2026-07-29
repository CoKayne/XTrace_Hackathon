import {
  divideDecimalStrings,
  multiplyDecimalStrings,
  requireNonNegativeDecimalString,
  requirePositiveDecimalString,
  subtractDecimalStrings,
} from "../numbers";
import {
  completedCalculation,
  calculationId,
  type CalculationOptions,
  type CalculationResult,
  type FormulaStatus,
  type FormulaValueRef,
} from "./contracts";

type BenchmarkCompatibility =
  | "exact"
  | "broad_compatible"
  | "adjacent_only"
  | "unavailable";

export interface MarketCompsEvaluation {
  status: FormulaStatus;
  scenarios: {
    bear: string | null;
    base: string | null;
    bull: string | null;
  };
  pricingPremium: string | null;
  calculations: CalculationResult[];
  scenarioCalculationIds: {
    bear: string | null;
    base: string | null;
    bull: string | null;
  };
  pricingPremiumCalculationId: string | null;
  claimEdges: [];
  blockerCodes: string[];
}

const emptyScenarios = {
  bear: null,
  base: null,
  bull: null,
} as const;

export function evaluateMarketComps(input: {
  benchmarkValue: FormulaValueRef | null;
  benchmarkFreshness?: FormulaValueRef | null;
  currentReportedValuation: FormulaValueRef | null;
  compatibility: BenchmarkCompatibility;
  stale: boolean | null;
  multipliers: {
    bear: FormulaValueRef | null;
    base: FormulaValueRef | null;
    bull: FormulaValueRef | null;
  };
}, options: CalculationOptions = {}): MarketCompsEvaluation {
  if (input.stale === null) {
    return unavailable(
      "insufficient_input",
      "benchmark_freshness_missing",
    );
  }
  if (input.stale) {
    return unavailable("stale_benchmark", "benchmark_stale");
  }
  if (
    input.compatibility === "adjacent_only"
    || input.compatibility === "unavailable"
  ) {
    return unavailable("not_applicable", "benchmark_incompatible");
  }
  if (
    input.benchmarkValue === null
    || input.multipliers.bear === null
    || input.multipliers.base === null
    || input.multipliers.bull === null
  ) {
    return unavailable("insufficient_input", "benchmark_input_missing");
  }
  if (input.benchmarkValue.currency === null) {
    return unavailable("insufficient_input", "benchmark_currency_missing");
  }
  if (
    input.currentReportedValuation !== null
    && input.currentReportedValuation.currency === null
  ) {
    return unavailable(
      "insufficient_input",
      "current_valuation_currency_missing",
    );
  }
  if (
    input.benchmarkValue.currency !== "USD"
    || (
      input.currentReportedValuation !== null
      && input.currentReportedValuation.currency
        !== input.benchmarkValue.currency
    )
  ) {
    return unavailable("unsupported_terms", "currency_unsupported");
  }

  try {
    const benchmark = requirePositiveDecimalString(
      input.benchmarkValue.value,
    );
    const bearMultiplier = requirePositiveDecimalString(
      input.multipliers.bear.value,
    );
    const baseMultiplier = requirePositiveDecimalString(
      input.multipliers.base.value,
    );
    const bullMultiplier = requirePositiveDecimalString(
      input.multipliers.bull.value,
    );
    const scenarios = {
      bear: multiplyDecimalStrings(benchmark, bearMultiplier),
      base: multiplyDecimalStrings(benchmark, baseMultiplier),
      bull: multiplyDecimalStrings(benchmark, bullMultiplier),
    };
    if (
      new DecimalOrder(scenarios.bear).greaterThan(scenarios.base)
      || new DecimalOrder(scenarios.base).greaterThan(scenarios.bull)
    ) {
      return unavailable("invalid_domain", "scenario_multipliers_unordered");
    }

    const computedAt = (options.now ?? (() => new Date()))().toISOString();
    const benchmarkInputs = input.benchmarkFreshness
      ? [input.benchmarkValue, input.benchmarkFreshness]
      : [input.benchmarkValue];
    const scenarioCalculationIds = {
      bear: calculationId(
        options.calculationScope ?? "standalone",
        "market_comps_v1",
        "bear_valuation",
      ),
      base: calculationId(
        options.calculationScope ?? "standalone",
        "market_comps_v1",
        "base_valuation",
      ),
      bull: calculationId(
        options.calculationScope ?? "standalone",
        "market_comps_v1",
        "bull_valuation",
      ),
    };
    const calculations: CalculationResult[] = ([
      ["bear", input.multipliers.bear, scenarios.bear],
      ["base", input.multipliers.base, scenarios.base],
      ["bull", input.multipliers.bull, scenarios.bull],
    ] as const).map(([scenario, multiplier, output]) =>
      completedCalculation({
        formulaId: "market_comps_v1",
        outputField: `${scenario}_valuation`,
        inputRefs: [...benchmarkInputs, multiplier],
        output,
        unit: "currency",
        currency: input.benchmarkValue!.currency,
        period: scenario,
        computedAt,
        calculationScope: options.calculationScope,
      })
    );

    let pricingPremium: string | null = null;
    let pricingPremiumCalculationId: string | null = null;
    if (input.currentReportedValuation !== null) {
      const current = requireNonNegativeDecimalString(
        input.currentReportedValuation.value,
      );
      pricingPremium = subtractDecimalStrings(
        divideDecimalStrings(current, benchmark),
        "1",
      );
      pricingPremiumCalculationId = calculationId(
        options.calculationScope ?? "standalone",
        "market_comps_v1",
        "pricing_premium",
      );
      calculations.push(completedCalculation({
        formulaId: "market_comps_v1",
        outputField: "pricing_premium",
        inputRefs: [
          input.currentReportedValuation,
          ...benchmarkInputs,
        ],
        output: pricingPremium,
        unit: "decimal",
        computedAt,
        calculationScope: options.calculationScope,
      }));
    }

    return {
      status: "completed",
      scenarios,
      pricingPremium,
      calculations,
      scenarioCalculationIds,
      pricingPremiumCalculationId,
      claimEdges: [],
      blockerCodes: [],
    };
  } catch {
    return unavailable("invalid_domain", "market_comps_invalid_domain");
  }
}

function unavailable(
  status: Exclude<FormulaStatus, "completed">,
  blockerCode: string,
): MarketCompsEvaluation {
  return {
    status,
    scenarios: { ...emptyScenarios },
    pricingPremium: null,
    calculations: [],
    scenarioCalculationIds: { ...emptyScenarios },
    pricingPremiumCalculationId: null,
    claimEdges: [],
    blockerCodes: [blockerCode],
  };
}

class DecimalOrder {
  constructor(private readonly value: string) {}

  greaterThan(other: string): boolean {
    const difference = subtractDecimalStrings(this.value, other);
    return !difference.startsWith("-") && difference !== "0";
  }
}
