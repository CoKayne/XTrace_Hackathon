import { z } from "zod";

import type {
  PolicyFieldDiff,
  UnderwritingReferencesRepository,
} from "../../../db/repositories/underwriting-references";
import type { FundPolicySnapshot } from "../../contracts/underwriting";
import {
  BALANCED_POLICY_TEMPLATE_ID,
  type FundPolicyValues,
} from "../../../seed/underwriting/balanced-policy-v1";

const ReturnTargetSchema = z.strictObject({
  grossMoic: z.string().min(1),
  grossIrr: z.string().min(1),
  horizonYears: z.string().min(1),
});

export const FundPolicyValuesSchema = z.strictObject({
  id: z.literal(BALANCED_POLICY_TEMPLATE_ID),
  riskPreference: z.string().min(1),
  baseCurrency: z.string().min(1),
  stageMandate: z.array(z.string().min(1)),
  businessModelMandate: z.array(z.string().min(1)),
  geographyMandate: z.array(z.string().min(1)),
  committedFundSize: z.string().min(1),
  remainingDeployableCapital: z.string().min(1),
  initialCheckMin: z.string().min(1),
  initialCheckMax: z.string().min(1),
  targetOwnership: z.string().min(1),
  targetOwnershipMin: z.string().min(1),
  targetOwnershipMax: z.string().min(1),
  hardMinimumOwnership: z.string().min(1).nullable(),
  reserveMultipleOfInitialCheck: z.string().min(1),
  portfolioConcentrationLimit: z.string().min(1),
  returnTargets: z.strictObject({
    seed: ReturnTargetSchema,
    series_a: ReturnTargetSchema,
  }),
  scenarioPriceMultipliers: z.strictObject({
    bear: z.string().min(1),
    base: z.string().min(1),
    bull: z.string().min(1),
  }),
  valuationPremiumReviewThreshold: z.string().min(1),
  valuationPremiumBlockerThreshold: z.string().min(1),
  acceptableFutureDilution: z.string().min(1),
  humanFinalApproval: z.boolean(),
  externalActionMode: z.string().min(1),
});

const ExpectedVersionSchema = z.string().min(1).nullable();

const SavePolicySchema = z.strictObject({
  expectedActiveVersionId: ExpectedVersionSchema,
  values: FundPolicyValuesSchema,
});

const ApplyRecommendedSchema = z.strictObject({
  expectedActiveVersionId: ExpectedVersionSchema,
});

const RestoreVersionSchema = z.strictObject({
  versionId: z.string().min(1),
});

export interface UnderwritingReferencesService {
  activePolicy(workspaceId: string): Promise<FundPolicySnapshot>;
  savePolicy(input: {
    workspaceId: string;
    actorId: string;
    body: unknown;
  }): Promise<FundPolicySnapshot>;
  applyRecommended(input: {
    workspaceId: string;
    actorId: string;
    body: unknown;
  }): Promise<{
    snapshot: FundPolicySnapshot;
    overwrittenDiff: PolicyFieldDiff[];
  }>;
  listPolicyVersions(workspaceId: string): Promise<FundPolicySnapshot[]>;
  restorePolicyVersion(input: {
    workspaceId: string;
    actorId: string;
    body: unknown;
  }): Promise<FundPolicySnapshot>;
}

export function createUnderwritingReferencesService(
  repository: UnderwritingReferencesRepository,
): UnderwritingReferencesService {
  return {
    activePolicy(workspaceId) {
      return repository.activeFundPolicy(workspaceId);
    },

    savePolicy(input) {
      const body = SavePolicySchema.parse(input.body);
      return repository.saveCustomPolicy({
        workspaceId: input.workspaceId,
        actorId: input.actorId,
        expectedActiveVersionId: body.expectedActiveVersionId,
        values: body.values as FundPolicyValues,
      });
    },

    applyRecommended(input) {
      const body = ApplyRecommendedSchema.parse(input.body);
      return repository.applyBalancedDefaults({
        workspaceId: input.workspaceId,
        actorId: input.actorId,
        expectedActiveVersionId: body.expectedActiveVersionId,
      });
    },

    listPolicyVersions(workspaceId) {
      return repository.listFundPolicyVersions(workspaceId);
    },

    restorePolicyVersion(input) {
      const body = RestoreVersionSchema.parse(input.body);
      return repository.restorePolicyVersion({
        workspaceId: input.workspaceId,
        actorId: input.actorId,
        versionId: body.versionId,
      });
    },
  };
}
