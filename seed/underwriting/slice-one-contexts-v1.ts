import { SYNTHETIC_FRAMEWORK_PACK_ID } from "./framework-pack-v1";

export type SliceOneStage = "seed" | "series_a";
export type SliceOneBusinessModel = "b2b_saas" | "enterprise_ai";
export type SliceOneGeography = "us" | "global";

export interface SliceOneContextProfile {
  id: string;
  contextVersion: "1";
  stage: SliceOneStage;
  businessModel: SliceOneBusinessModel;
  criticalEvidenceProfileId: string;
  usBenchmarkPackId: string;
  usBenchmarkCompatibility: "exact" | "broad_compatible";
  valuationMethodPolicyId: string;
  decisionPolicyId: string;
  frameworkPackId: string;
}

export const SYNTHETIC_US_SOFTWARE_BENCHMARK_PACK_ID =
  "benchmark_pack_synthetic_us_software_v1";

export const SLICE_ONE_CONTEXTS: SliceOneContextProfile[] = [
  context("seed", "b2b_saas", "exact"),
  context("seed", "enterprise_ai", "broad_compatible"),
  context("series_a", "b2b_saas", "exact"),
  context("series_a", "enterprise_ai", "broad_compatible"),
];

function context(
  stage: SliceOneStage,
  businessModel: SliceOneBusinessModel,
  compatibility: SliceOneContextProfile["usBenchmarkCompatibility"],
): SliceOneContextProfile {
  const stem = `${stage}_${businessModel}`;
  return {
    id: `underwriting_context_${stem}_v1`,
    contextVersion: "1",
    stage,
    businessModel,
    criticalEvidenceProfileId: `critical_evidence_${stem}_v1`,
    usBenchmarkPackId: SYNTHETIC_US_SOFTWARE_BENCHMARK_PACK_ID,
    usBenchmarkCompatibility: compatibility,
    valuationMethodPolicyId: `valuation_method_${stem}_v1`,
    decisionPolicyId: `decision_policy_${stem}_v1`,
    frameworkPackId: SYNTHETIC_FRAMEWORK_PACK_ID,
  };
}
