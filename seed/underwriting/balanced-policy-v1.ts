export interface ReturnTarget {
  grossMoic: string;
  grossIrr: string;
  horizonYears: string;
}

export interface FundPolicyValues {
  id: string;
  riskPreference: string;
  baseCurrency: string;
  stageMandate: string[];
  businessModelMandate: string[];
  geographyMandate: string[];
  committedFundSize: string;
  remainingDeployableCapital: string;
  initialCheckMin: string;
  initialCheckMax: string;
  targetOwnership: string;
  targetOwnershipMin: string;
  targetOwnershipMax: string;
  hardMinimumOwnership: string | null;
  reserveMultipleOfInitialCheck: string;
  portfolioConcentrationLimit: string;
  returnTargets: {
    seed: ReturnTarget;
    series_a: ReturnTarget;
  };
  scenarioPriceMultipliers: {
    bear: string;
    base: string;
    bull: string;
  };
  valuationPremiumReviewThreshold: string;
  valuationPremiumBlockerThreshold: string;
  acceptableFutureDilution: string;
  humanFinalApproval: boolean;
  externalActionMode: string;
}

export const BALANCED_POLICY_TEMPLATE_ID =
  "fund_policy_balanced_us_software_v1";

export const BALANCED_POLICY_VALUES: FundPolicyValues = {
  id: BALANCED_POLICY_TEMPLATE_ID,
  riskPreference: "balanced",
  baseCurrency: "USD",
  stageMandate: ["seed", "series_a"],
  businessModelMandate: ["b2b_saas", "enterprise_ai"],
  geographyMandate: ["global"],
  committedFundSize: "200000000",
  remainingDeployableCapital: "140000000",
  initialCheckMin: "1500000",
  initialCheckMax: "8000000",
  targetOwnership: "0.10",
  targetOwnershipMin: "0.075",
  targetOwnershipMax: "0.15",
  hardMinimumOwnership: null,
  reserveMultipleOfInitialCheck: "1.0",
  portfolioConcentrationLimit: "0.10",
  returnTargets: {
    seed: {
      grossMoic: "5",
      grossIrr: "0.2228445449938519",
      horizonYears: "8",
    },
    series_a: {
      grossMoic: "3",
      grossIrr: "0.169930812758687",
      horizonYears: "7",
    },
  },
  scenarioPriceMultipliers: {
    bear: "0.75",
    base: "1",
    bull: "1.25",
  },
  valuationPremiumReviewThreshold: "0.25",
  valuationPremiumBlockerThreshold: "0.50",
  acceptableFutureDilution: "0.50",
  humanFinalApproval: true,
  externalActionMode: "draft_only",
};
