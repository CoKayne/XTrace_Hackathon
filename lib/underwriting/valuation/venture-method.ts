import {
  divideDecimalStrings,
  multiplyDecimalStrings,
  requireNonNegativeDecimalString,
  requirePositiveDecimalString,
  subtractDecimalStrings,
} from "../numbers";
import {
  completedCalculation,
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
}, options: {
  now?: () => Date;
} = {}): FormulaEvaluation<VentureMethodValue> {
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
    const inputRefs = [
      input.investment,
      input.targetGrossMoic,
      input.exitArr,
      input.exitArrMultiple,
      input.futureDilutionRate,
    ];
    const currencyOutputs = new Set([
      "exitEquityValue",
      "requiredExitProceeds",
      "maximumAcceptablePostMoney",
      "maximumAcceptablePreMoney",
    ]);
    return {
      status: "completed",
      value,
      calculations: Object.entries(value).map(([outputField, output]) =>
        completedCalculation({
          formulaId: "venture_return_method_v1",
          outputField,
          inputRefs,
          output,
          unit: currencyOutputs.has(outputField) ? "currency" : "decimal",
          currency: currencyOutputs.has(outputField) ? "USD" : null,
          computedAt,
        })
      ),
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
    blockerCodes: [blockerCode],
  };
}
