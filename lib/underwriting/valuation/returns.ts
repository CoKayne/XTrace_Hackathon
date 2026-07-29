import Decimal from "decimal.js";

import {
  divideDecimalStrings,
  requireNonNegativeDecimalString,
  requirePositiveDecimalString,
  roundDecimalStringForDisplay,
} from "../numbers";
import {
  calculationId,
  completedCalculation,
  type CalculationOptions,
  type FormulaEvaluation,
  type FormulaValueRef,
} from "./contracts";

const ReturnDecimal = Decimal.clone({
  precision: 40,
  rounding: Decimal.ROUND_HALF_EVEN,
});

export function computeGrossReturns(input: {
  invested: string;
  proceeds: string;
  holdingYears: string;
}): {
  moic: string;
  irr: string;
  irrRoundedForDisplay: string;
} {
  const invested = requirePositiveDecimalString(input.invested);
  const proceeds = requireNonNegativeDecimalString(input.proceeds);
  const holdingYears = requirePositiveDecimalString(input.holdingYears);
  const moic = divideDecimalStrings(proceeds, invested);
  const irrDecimal = new ReturnDecimal(moic)
    .pow(new ReturnDecimal(1).dividedBy(holdingYears))
    .minus(1);
  if (!irrDecimal.isFinite()) {
    throw new RangeError("Gross IRR result must be finite");
  }
  const irr = irrDecimal.isZero() ? "0" : irrDecimal.toFixed();
  return {
    moic,
    irr,
    irrRoundedForDisplay: roundDecimalStringForDisplay(irr, 4),
  };
}

export function evaluateGrossReturns(input: {
  invested: FormulaValueRef | null;
  proceeds: FormulaValueRef | null;
  holdingYears: FormulaValueRef | null;
  lineageInputRefs?: FormulaValueRef[];
}, options: CalculationOptions = {}): FormulaEvaluation<
  ReturnType<typeof computeGrossReturns>
> {
  if (
    input.invested === null
    || input.proceeds === null
    || input.holdingYears === null
  ) {
    return unavailable("insufficient_input", "gross_return_input_missing");
  }
  if (input.invested.currency === null || input.proceeds.currency === null) {
    return unavailable("insufficient_input", "return_currency_missing");
  }
  if (
    input.invested.currency !== "USD"
    || input.proceeds.currency !== input.invested.currency
  ) {
    return unavailable("unsupported_terms", "currency_unsupported");
  }
  try {
    const value = computeGrossReturns({
      invested: input.invested.value,
      proceeds: input.proceeds.value,
      holdingYears: input.holdingYears.value,
    });
    const computedAt = (options.now ?? (() => new Date()))().toISOString();
    const proceedsLineage = input.lineageInputRefs ?? [input.proceeds];
    return {
      status: "completed",
      value,
      calculations: [
        completedCalculation({
          formulaId: "gross_deal_moic_v1",
          outputField: "gross_moic",
          inputRefs: [input.invested, ...proceedsLineage],
          output: value.moic,
          unit: "multiple",
          computedAt,
          calculationScope: options.calculationScope,
        }),
        completedCalculation({
          formulaId: "annualized_gross_irr_v1",
          outputField: "gross_irr",
          inputRefs: [input.holdingYears],
          output: value.irr,
          unit: "decimal",
          period: input.holdingYears.value,
          computedAt,
          calculationScope: options.calculationScope,
        }),
      ],
      claimEdges: [{
        claimItemId: calculationId(
          options.calculationScope ?? "standalone",
          "annualized_gross_irr_v1",
          "gross_irr",
        ),
        dependencyItemId: calculationId(
          options.calculationScope ?? "standalone",
          "gross_deal_moic_v1",
          "gross_moic",
        ),
        dependencyType: "calculation",
      }],
      blockerCodes: [],
    };
  } catch {
    return unavailable("invalid_domain", "gross_return_invalid_domain");
  }
}

function unavailable(
  status: FormulaEvaluation<never>["status"],
  blockerCode: string,
): FormulaEvaluation<ReturnType<typeof computeGrossReturns>> {
  return {
    status,
    value: null,
    calculations: [],
    claimEdges: [],
    blockerCodes: [blockerCode],
  };
}
