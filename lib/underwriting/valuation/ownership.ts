import {
  addDecimalStrings,
  divideDecimalStrings,
  multiplyDecimalStrings,
  requireNonNegativeDecimalString,
  requirePositiveDecimalString,
  subtractDecimalStrings,
} from "../numbers";
import {
  calculationId,
  completedCalculation,
  type CalculationOptions,
  type FormulaEvaluation,
  type FormulaValueRef,
} from "./contracts";

export function computeOwnership(input: {
  investment: string;
  preMoney: string;
}): {
  postMoney: string;
  initialOwnership: string;
} {
  const investment = requirePositiveDecimalString(input.investment);
  const preMoney = requireNonNegativeDecimalString(input.preMoney);
  const postMoney = addDecimalStrings(preMoney, investment);
  return {
    postMoney,
    initialOwnership: divideDecimalStrings(investment, postMoney),
  };
}

export function applyFutureDilution(
  initialOwnershipInput: string,
  futureDilutionRateInput: string,
): string {
  const initialOwnership = requireNonNegativeDecimalString(
    initialOwnershipInput,
  );
  const futureDilutionRate = requireNonNegativeDecimalString(
    futureDilutionRateInput,
  );
  if (
    divideDecimalStrings(futureDilutionRate, "1") !== futureDilutionRate
    || subtractDecimalStrings("1", futureDilutionRate).startsWith("-")
    || futureDilutionRate === "1"
  ) {
    throw new RangeError("Future dilution must be at least zero and below one");
  }
  return multiplyDecimalStrings(
    initialOwnership,
    subtractDecimalStrings("1", futureDilutionRate),
  );
}

export function evaluateOwnership(input: {
  investment: FormulaValueRef | null;
  preMoney: FormulaValueRef | null;
  futureDilutionRate: FormulaValueRef | null;
}, options: CalculationOptions = {}): FormulaEvaluation<{
  postMoney: string;
  initialOwnership: string;
  postDilutionOwnership: string;
}> {
  if (
    input.investment === null
    || input.preMoney === null
    || input.futureDilutionRate === null
  ) {
    return unavailable("insufficient_input", "ownership_input_missing");
  }
  if (
    input.investment.currency === null
    || input.preMoney.currency === null
  ) {
    return unavailable("insufficient_input", "ownership_currency_missing");
  }
  if (
    input.investment.currency !== "USD"
    || input.preMoney.currency !== input.investment.currency
  ) {
    return unavailable("unsupported_terms", "currency_unsupported");
  }
  try {
    const ownership = computeOwnership({
      investment: input.investment.value,
      preMoney: input.preMoney.value,
    });
    const postDilutionOwnership = applyFutureDilution(
      ownership.initialOwnership,
      input.futureDilutionRate.value,
    );
    const computedAt = (options.now ?? (() => new Date()))().toISOString();
    return {
      status: "completed",
      value: { ...ownership, postDilutionOwnership },
      calculations: [
        completedCalculation({
          formulaId: "simple_pre_post_ownership_v1",
          outputField: "post_money",
          inputRefs: [input.investment, input.preMoney],
          output: ownership.postMoney,
          unit: "currency",
          currency: input.investment.currency,
          computedAt,
          calculationScope: options.calculationScope,
        }),
        completedCalculation({
          formulaId: "simple_pre_post_ownership_v1",
          outputField: "initial_ownership",
          inputRefs: [input.investment, input.preMoney],
          output: ownership.initialOwnership,
          unit: "decimal",
          computedAt,
          calculationScope: options.calculationScope,
        }),
        completedCalculation({
          formulaId: "future_dilution_v1",
          outputField: "post_dilution_ownership",
          inputRefs: [input.futureDilutionRate],
          output: postDilutionOwnership,
          unit: "decimal",
          computedAt,
          calculationScope: options.calculationScope,
        }),
      ],
      claimEdges: [{
        claimItemId: calculationId(
          options.calculationScope ?? "standalone",
          "future_dilution_v1",
          "post_dilution_ownership",
        ),
        dependencyItemId: calculationId(
          options.calculationScope ?? "standalone",
          "simple_pre_post_ownership_v1",
          "initial_ownership",
        ),
        dependencyType: "calculation",
      }],
      blockerCodes: [],
    };
  } catch {
    return unavailable("invalid_domain", "ownership_invalid_domain");
  }
}

function unavailable(
  status: FormulaEvaluation<never>["status"],
  blockerCode: string,
): FormulaEvaluation<{
  postMoney: string;
  initialOwnership: string;
  postDilutionOwnership: string;
}> {
  return {
    status,
    value: null,
    calculations: [],
    claimEdges: [],
    blockerCodes: [blockerCode],
  };
}
