import type {
  EvidenceCoverageResult,
  EvidencePack,
  Fact,
} from "../contracts/evidence";
import type {
  ResolvedUnderwritingContext,
} from "../contracts/underwriting";
import {
  SLICE_ONE_CONTEXTS,
  type SliceOneContextProfile,
} from "../../seed/underwriting/slice-one-contexts-v1";

export type RouterEvidenceBasis =
  | "confirmed"
  | "source_explicit"
  | "derived";

export interface RouterEvidenceValue {
  value: string;
  basis: RouterEvidenceBasis;
  evidenceItemId: string;
}

export interface CandidateIdentityEvidence {
  asOfDate: string;
  companyIdentity: RouterEvidenceValue[];
  stage: RouterEvidenceValue[];
  businessModel: RouterEvidenceValue[];
  geography: RouterEvidenceValue[];
  securityType: RouterEvidenceValue[];
}

export interface CriticalEvidenceField {
  fieldId: string;
  critical: boolean;
  minimumModelInput: boolean;
  acceptedAssertionStatuses: Fact["assertionStatus"][];
  acceptedFreshness: Fact["freshness"][];
}

export interface CriticalEvidenceProfile {
  id: string;
  version: string;
  publicationStatus: "draft" | "published" | "retired";
  fields: CriticalEvidenceField[];
}

export type RouterResolution =
  | {
    kind: "resolved";
    context: ResolvedUnderwritingContext | null;
    analysisMode: "full" | "core_only";
    decisionCeiling: "Advance" | "Invest Candidate";
    evidenceItemIds: string[];
  }
  | {
    kind: "needs_confirmation";
    fields: Array<
      "stage" | "businessModel" | "geography" | "securityType"
    >;
  }
  | {
    kind: "unavailable";
    reasonCodes: string[];
  };

export interface ContextRouter {
  resolve(input: CandidateIdentityEvidence): RouterResolution;
  evaluateCoverage(input: {
    pack: EvidencePack;
    profile: CriticalEvidenceProfile;
  }): EvidenceCoverageResult;
}

export function createContextRouter(options: {
  contexts?: SliceOneContextProfile[];
} = {}): ContextRouter {
  const contexts = options.contexts ?? SLICE_ONE_CONTEXTS;
  return {
    resolve(input) {
      const companyIdentity = selectPrimary(input.companyIdentity);
      if (companyIdentity.kind !== "selected") {
        return {
          kind: "unavailable",
          reasonCodes: [
            companyIdentity.kind === "missing"
              ? "COMPANY_IDENTITY_MISSING"
              : "COMPANY_IDENTITY_AMBIGUOUS",
          ],
        };
      }

      const selections = {
        stage: selectPrimary(input.stage),
        businessModel: selectPrimary(input.businessModel),
        geography: selectPrimary(input.geography),
        securityType: selectPrimary(input.securityType),
      };
      const fields = (
        Object.keys(selections) as Array<keyof typeof selections>
      ).filter((field) => selections[field].kind !== "selected");
      if (fields.length > 0) {
        return { kind: "needs_confirmation", fields };
      }

      const stage = selectedValue(selections.stage);
      const businessModel = selectedValue(selections.businessModel);
      const geography = selectedValue(selections.geography);
      const securityType = selectedValue(selections.securityType);
      const profile = contexts.find((candidate) =>
        candidate.stage === stage
        && candidate.businessModel === businessModel
      );
      if (
        !profile
        || !["us", "global"].includes(geography)
        || securityType !== "preferred"
      ) {
        return {
          kind: "resolved",
          context: null,
          analysisMode: "core_only",
          decisionCeiling: "Advance",
          evidenceItemIds: selectedEvidenceIds(
            companyIdentity,
            ...Object.values(selections),
          ),
        };
      }

      const benchmarkCompatibility = geography === "us"
        ? profile.usBenchmarkCompatibility
        : "unavailable";
      const context: ResolvedUnderwritingContext = {
        id: profile.id,
        contextVersion: profile.contextVersion,
        stage: profile.stage,
        businessModel: profile.businessModel,
        geography: geography as ResolvedUnderwritingContext["geography"],
        securityType: "preferred",
        asOfDate: input.asOfDate,
        criticalEvidenceProfileId: profile.criticalEvidenceProfileId,
        benchmarkPackId: geography === "us"
          ? profile.usBenchmarkPackId
          : null,
        benchmarkCompatibility,
        valuationMethodPolicyId: profile.valuationMethodPolicyId,
        decisionPolicyId: profile.decisionPolicyId,
        frameworkPackId: profile.frameworkPackId,
      };
      const full = context.benchmarkPackId !== null
        && ["exact", "broad_compatible"].includes(
          context.benchmarkCompatibility,
        );
      return {
        kind: "resolved",
        context,
        analysisMode: full ? "full" : "core_only",
        decisionCeiling: full ? "Invest Candidate" : "Advance",
        evidenceItemIds: selectedEvidenceIds(
          companyIdentity,
          ...Object.values(selections),
        ),
      };
    },

    evaluateCoverage({ pack, profile }) {
      const acceptedFields = new Set(
        profile.fields
          .filter((requirement) =>
            pack.facts.some((fact) =>
              acceptedFor(requirement, fact)
            )
          )
          .map(({ fieldId }) => fieldId),
      );
      const missingRequirements = profile.fields.filter(
        ({ fieldId }) => !acceptedFields.has(fieldId),
      );
      const minimumMissing = missingRequirements.filter(
        ({ minimumModelInput }) => minimumModelInput,
      );
      const criticalFields = new Set(
        profile.fields
          .filter(({ critical }) => critical)
          .map(({ fieldId }) => fieldId),
      );
      const blockingConflictIds = pack.conflicts
        .filter((conflict) =>
          conflict.status === "open"
          && conflict.material
          && criticalFields.has(conflict.field)
        )
        .map(({ id }) => id)
        .sort(compareUtf8);
      const criticalEvidenceComplete =
        missingRequirements.every(({ critical }) => !critical)
        && blockingConflictIds.length === 0
        && profile.publicationStatus === "published";
      const minimumModelInputsComplete = minimumMissing.length === 0;
      const reasonCodes = [
        ...(!minimumModelInputsComplete
          ? ["MISSING_MINIMUM_MODEL_INPUTS"]
          : []),
        ...(missingRequirements.some(({ critical }) => critical)
          ? ["MISSING_CRITICAL_EVIDENCE"]
          : []),
        ...(blockingConflictIds.length > 0
          ? ["MATERIAL_OPEN_CONFLICT"]
          : []),
        ...(profile.publicationStatus !== "published"
          ? ["CRITICAL_EVIDENCE_PROFILE_NOT_PUBLISHED"]
          : []),
      ];

      return {
        minimumModelInputsComplete,
        criticalEvidenceComplete,
        missingFieldIds: missingRequirements
          .map(({ fieldId }) => fieldId),
        blockingConflictIds,
        decisionCeiling: minimumModelInputsComplete
          ? criticalEvidenceComplete
            ? "Invest Candidate"
            : "Advance"
          : null,
        underwritingStatus: minimumModelInputsComplete
          ? "available"
          : "unavailable",
        reasonCodes,
      };
    },
  };
}

type Selection =
  | { kind: "selected"; claim: RouterEvidenceValue }
  | { kind: "missing" }
  | { kind: "ambiguous" };

function selectPrimary(values: RouterEvidenceValue[]): Selection {
  for (const basis of [
    "confirmed",
    "source_explicit",
    "derived",
  ] as const) {
    const candidates = values.filter((candidate) =>
      candidate.basis === basis && candidate.value.trim()
    );
    if (candidates.length === 0) continue;
    const distinctValues = new Set(
      candidates.map(({ value }) => value.trim().toLowerCase()),
    );
    if (distinctValues.size !== 1) return { kind: "ambiguous" };
    return { kind: "selected", claim: candidates[0]! };
  }
  return { kind: "missing" };
}

function selectedValue(selection: Selection): string {
  return selection.kind === "selected"
    ? selection.claim.value.trim().toLowerCase()
    : "";
}

function selectedEvidenceIds(...selections: Selection[]): string[] {
  return selections
    .flatMap((selection) =>
      selection.kind === "selected"
        ? [selection.claim.evidenceItemId]
        : []
    )
    .sort(compareUtf8);
}

function acceptedFor(
  requirement: CriticalEvidenceField,
  fact: Fact,
): boolean {
  return fact.field === requirement.fieldId
    && fact.acceptedForGate
    && requirement.acceptedAssertionStatuses.includes(fact.assertionStatus)
    && requirement.acceptedFreshness.includes(fact.freshness);
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}
