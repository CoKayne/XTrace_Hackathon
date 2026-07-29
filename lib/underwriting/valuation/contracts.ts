import type { EvidencePack } from "../../contracts/evidence";
import type {
  FundPolicySnapshot,
  ResolvedUnderwritingContext,
  ValuationEvaluation,
} from "../../contracts/underwriting";

export type FormulaStatus =
  | "completed"
  | "not_applicable"
  | "insufficient_input"
  | "unsupported_terms"
  | "invalid_domain"
  | "stale_benchmark";

export interface FormulaValueRef {
  itemId: string;
  value: string;
  type: "fact" | "assumption" | "policy" | "benchmark";
}

export interface CalculationResult {
  id: string;
  analysisType: "calculation";
  formulaId:
    | "market_comps_v1"
    | "venture_return_method_v1"
    | "simple_pre_post_ownership_v1"
    | "future_dilution_v1"
    | "gross_deal_moic_v1"
    | "annualized_gross_irr_v1";
  formulaVersion: "1";
  outputField: string;
  inputRefs: FormulaValueRef[];
  output: string | null;
  unit: string;
  currency: string | null;
  period: string | null;
  roundingPolicy: "half_even_display_only";
  computedAt: string;
  status: FormulaStatus;
}

export interface FormulaEvaluation<T> {
  status: FormulaStatus;
  value: T | null;
  calculations: CalculationResult[];
  blockerCodes: string[];
}

export interface ValuationEngine {
  evaluate(input: {
    pack: EvidencePack;
    context: ResolvedUnderwritingContext;
    fundPolicy: FundPolicySnapshot;
  }): ValuationEvaluation;
}

export function completedCalculation(input: {
  formulaId: CalculationResult["formulaId"];
  outputField: string;
  inputRefs: FormulaValueRef[];
  output: string;
  unit: string;
  currency?: string | null;
  period?: string | null;
  computedAt: string;
}): CalculationResult {
  return {
    id: `calculation:${input.formulaId}:${input.outputField}`,
    analysisType: "calculation",
    formulaId: input.formulaId,
    formulaVersion: "1",
    outputField: input.outputField,
    inputRefs: input.inputRefs.map((item) => ({ ...item })),
    output: input.output,
    unit: input.unit,
    currency: input.currency ?? null,
    period: input.period ?? null,
    roundingPolicy: "half_even_display_only",
    computedAt: input.computedAt,
    status: "completed",
  };
}
