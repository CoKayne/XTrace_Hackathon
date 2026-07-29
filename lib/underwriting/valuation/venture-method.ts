import {
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

export interface VentureMethodValue {
  exitEquityValue: string;
  requiredExitProceeds: string;
  requiredPostDilutionOwnership: string;
  requiredInitialOwnership: string;
  maximumAcceptablePostMoney: string;
  maximumAcceptablePreMoney: string;
}

export function evaluateVentureMethod(input: {
  terms:
    | "simple_pre_money_preferred"
    | "safe"
    | "convertible_note"
    | "option_pool"
    | "preferred_waterfall";
  investment: FormulaValueRef | null;
  targetGrossMoic: FormulaValueRef | null;
  exitArr: FormulaValueRef | null;
  exitArrMultiple: FormulaValueRef | null;
  futureDilutionRate: FormulaValueRef | null;
}, options: CalculationOptions = {}): FormulaEvaluation<VentureMethodValue> {
  if (input.terms !== "simple_pre_money_preferred") {
    return unavailable("unsupported_terms", "unsupported_financing_terms");
  }
  if (
    input.investment === null
    || input.targetGrossMoic === null
    || input.exitArr === null
    || input.exitArrMultiple === null
    || input.futureDilutionRate === null
  ) {
    return unavailable("insufficient_input", "venture_method_input_missing");
  }
  if (input.investment.currency === null || input.exitArr.currency === null) {
    return unavailable(
      "insufficient_input",
      "venture_method_currency_missing",
    );
  }
  if (
    input.investment.currency !== "USD"
    || input.exitArr.currency !== input.investment.currency
  ) {
    return unavailable("unsupported_terms", "currency_unsupported");
  }

  try {
    const investment = requirePositiveDecimalString(input.investment.value);
    const targetGrossMoic = requirePositiveDecimalString(
      input.targetGrossMoic.value,
    );
    const exitArr = requirePositiveDecimalString(input.exitArr.value);
    const exitArrMultiple = requirePositiveDecimalString(
      input.exitArrMultiple.value,
    );
    const futureDilutionRate = requireNonNegativeDecimalString(
      input.futureDilutionRate.value,
    );
    const retainedOwnership = subtractDecimalStrings(
      "1",
      futureDilutionRate,
    );
    if (
      retainedOwnership === "0"
      || retainedOwnership.startsWith("-")
    ) {
      return unavailable("invalid_domain", "future_dilution_invalid");
    }

    const value = {
      exitEquityValue: multiplyDecimalStrings(exitArr, exitArrMultiple),
      requiredExitProceeds: multiplyDecimalStrings(
        investment,
        targetGrossMoic,
      ),
      requiredPostDilutionOwnership: "",
      requiredInitialOwnership: "",
      maximumAcceptablePostMoney: "",
      maximumAcceptablePreMoney: "",
    };
    value.requiredPostDilutionOwnership = divideDecimalStrings(
      value.requiredExitProceeds,
      value.exitEquityValue,
    );
    value.requiredInitialOwnership = divideDecimalStrings(
      value.requiredPostDilutionOwnership,
      retainedOwnership,
    );
    value.maximumAcceptablePostMoney = divideDecimalStrings(
      investment,
      value.requiredInitialOwnership,
    );
    value.maximumAcceptablePreMoney = subtractDecimalStrings(
      value.maximumAcceptablePostMoney,
      investment,
    );
    if (value.maximumAcceptablePreMoney.startsWith("-")) {
      return unavailable(
        "invalid_domain",
        "maximum_acceptable_pre_money_negative",
      );
    }

    const computedAt = (options.now ?? (() => new Date()))().toISOString();
    const scope = options.calculationScope ?? "standalone";
    const ids = {
      exitEquityValue: calculationId(
        scope,
        "venture_return_method_v1",
        "exit_equity_value",
      ),
      requiredExitProceeds: calculationId(
        scope,
        "venture_return_method_v1",
        "required_exit_proceeds",
      ),
      requiredPostDilutionOwnership: calculationId(
        scope,
        "venture_return_method_v1",
        "required_post_dilution_ownership",
      ),
      requiredInitialOwnership: calculationId(
        scope,
        "venture_return_method_v1",
        "required_initial_ownership",
      ),
      maximumAcceptablePostMoney: calculationId(
        scope,
        "venture_return_method_v1",
        "maximum_acceptable_post_money",
      ),
      maximumAcceptablePreMoney: calculationId(
        scope,
        "venture_return_method_v1",
        "maximum_acceptable_pre_money",
      ),
    };
    return {
      status: "completed",
      value,
      calculations: [
        completedCalculation({
          formulaId: "venture_return_method_v1",
          outputField: "exit_equity_value",
          inputRefs: [input.exitArr, input.exitArrMultiple],
          output: value.exitEquityValue,
          unit: "currency",
          currency: input.investment.currency,
          computedAt,
          calculationScope: options.calculationScope,
        }),
        completedCalculation({
          formulaId: "venture_return_method_v1",
          outputField: "required_exit_proceeds",
          inputRefs: [input.investment, input.targetGrossMoic],
          output: value.requiredExitProceeds,
          unit: "currency",
          currency: input.investment.currency,
          computedAt,
          calculationScope: options.calculationScope,
        }),
        completedCalculation({
          formulaId: "venture_return_method_v1",
          outputField: "required_post_dilution_ownership",
          inputRefs: [],
          output: value.requiredPostDilutionOwnership,
          unit: "decimal",
          computedAt,
          calculationScope: options.calculationScope,
        }),
        completedCalculation({
          formulaId: "venture_return_method_v1",
          outputField: "required_initial_ownership",
          inputRefs: [input.futureDilutionRate],
          output: value.requiredInitialOwnership,
          unit: "decimal",
          computedAt,
          calculationScope: options.calculationScope,
        }),
        completedCalculation({
          formulaId: "venture_return_method_v1",
          outputField: "maximum_acceptable_post_money",
          inputRefs: [input.investment],
          output: value.maximumAcceptablePostMoney,
          unit: "currency",
          currency: input.investment.currency,
          computedAt,
          calculationScope: options.calculationScope,
        }),
        completedCalculation({
          formulaId: "venture_return_method_v1",
          outputField: "maximum_acceptable_pre_money",
          inputRefs: [input.investment],
          output: value.maximumAcceptablePreMoney,
          unit: "currency",
          currency: input.investment.currency,
          computedAt,
          calculationScope: options.calculationScope,
        }),
      ],
      claimEdges: [
        calculationEdge(
          ids.requiredPostDilutionOwnership,
          ids.requiredExitProceeds,
        ),
        calculationEdge(
          ids.requiredPostDilutionOwnership,
          ids.exitEquityValue,
        ),
        calculationEdge(
          ids.requiredInitialOwnership,
          ids.requiredPostDilutionOwnership,
        ),
        calculationEdge(
          ids.maximumAcceptablePostMoney,
          ids.requiredInitialOwnership,
        ),
        calculationEdge(
          ids.maximumAcceptablePreMoney,
          ids.maximumAcceptablePostMoney,
        ),
      ],
      blockerCodes: [],
    };
  } catch {
    return unavailable("invalid_domain", "venture_method_invalid_domain");
  }
}

function unavailable(
  status: FormulaEvaluation<never>["status"],
  blockerCode: string,
): FormulaEvaluation<VentureMethodValue> {
  return {
    status,
    value: null,
    calculations: [],
    claimEdges: [],
    blockerCodes: [blockerCode],
  };
}

function calculationEdge(
  claimItemId: string,
  dependencyItemId: string,
) {
  return {
    claimItemId,
    dependencyItemId,
    dependencyType: "calculation" as const,
  };
}
