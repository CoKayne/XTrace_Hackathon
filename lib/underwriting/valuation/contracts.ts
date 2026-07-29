import type {
  Calculation,
  ClaimEdge,
  EvidencePack,
} from "../../contracts/evidence";
import type {
  FundPolicySnapshot,
  ResolvedUnderwritingContext,
  ScenarioModel,
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
  unit: string | null;
  currency: string | null;
  period: string | null;
}

export type CalculationResult = Calculation;

export type FormulaId =
  | "market_comps_v1"
  | "venture_return_method_v1"
  | "simple_pre_post_ownership_v1"
  | "future_dilution_v1"
  | "gross_deal_moic_v1"
  | "annualized_gross_irr_v1";

export interface FormulaEvaluation<T> {
  status: FormulaStatus;
  value: T | null;
  calculations: Calculation[];
  claimEdges: ClaimEdge[];
  blockerCodes: string[];
}

export interface ValuationArtifactSet {
  evaluation: ValuationEvaluation;
  scenarioModel: ScenarioModel;
  calculations: Calculation[];
  calculationClaimEdges: ClaimEdge[];
}

export interface ValuationEngine {
  evaluate(input: {
    pack: EvidencePack;
    context: ResolvedUnderwritingContext;
    fundPolicy: FundPolicySnapshot;
  }): ValuationEvaluation;
  evaluateDetailed(input: {
    pack: EvidencePack;
    context: ResolvedUnderwritingContext;
    fundPolicy: FundPolicySnapshot;
  }): ValuationArtifactSet;
}

export interface CalculationOptions {
  now?: () => Date;
  calculationScope?: string;
}

export function completedCalculation(input: {
  formulaId: FormulaId;
  outputField: string;
  inputRefs: FormulaValueRef[];
  output: string;
  unit: string;
  currency?: string | null;
  period?: string | null;
  computedAt: string;
  calculationScope?: string;
}): Calculation {
  return {
    id: calculationId(
      input.calculationScope ?? "standalone",
      input.formulaId,
      input.outputField,
    ),
    analysisType: "calculation",
    formulaId: input.formulaId,
    formulaVersion: "1",
    inputRefs: input.inputRefs.map(({ itemId, value, type }) => ({
      itemId,
      value,
      type,
    })),
    output: input.output,
    unit: input.unit,
    currency: input.currency ?? null,
    period: input.period ?? null,
    roundingPolicy: "half_even_display_only",
    computedAt: input.computedAt,
    status: "completed",
  };
}

export function calculationId(
  scope: string,
  formulaId: FormulaId,
  outputField: string,
): string {
  return `calculation:${scope}:${formulaId}:${outputField}`;
}
