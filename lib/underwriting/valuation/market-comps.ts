import {
  divideDecimalStrings,
  multiplyDecimalStrings,
  requireNonNegativeDecimalString,
  requirePositiveDecimalString,
  subtractDecimalStrings,
} from "../numbers";
import {
  completedCalculation,
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
  blockerCodes: string[];
}

const emptyScenarios = {
  bear: null,
  base: null,
  bull: null,
} as const;

export function evaluateMarketComps(input: {
  benchmarkValue: FormulaValueRef | null;
  currentReportedValuation: FormulaValueRef | null;
  compatibility: BenchmarkCompatibility;
  stale: boolean;
  multipliers: {
    bear: FormulaValueRef | null;
    base: FormulaValueRef | null;
    bull: FormulaValueRef | null;
  };
}, options: {
  now?: () => Date;
} = {}): MarketCompsEvaluation {
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
    const calculations: CalculationResult[] = ([
      ["bear", input.multipliers.bear, scenarios.bear],
      ["base", input.multipliers.base, scenarios.base],
      ["bull", input.multipliers.bull, scenarios.bull],
    ] as const).map(([scenario, multiplier, output]) =>
      completedCalculation({
        formulaId: "market_comps_v1",
        outputField: `${scenario}_valuation`,
        inputRefs: [input.benchmarkValue!, multiplier],
        output,
        unit: "currency",
        currency: "USD",
        period: scenario,
        computedAt,
      })
    );

    let pricingPremium: string | null = null;
    if (input.currentReportedValuation !== null) {
      const current = requireNonNegativeDecimalString(
        input.currentReportedValuation.value,
      );
      pricingPremium = subtractDecimalStrings(
        divideDecimalStrings(current, benchmark),
        "1",
      );
      calculations.push(completedCalculation({
        formulaId: "market_comps_v1",
        outputField: "pricing_premium",
        inputRefs: [
          input.currentReportedValuation,
          input.benchmarkValue,
        ],
        output: pricingPremium,
        unit: "decimal",
        computedAt,
      }));
    }

    return {
      status: "completed",
      scenarios,
      pricingPremium,
      calculations,
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
