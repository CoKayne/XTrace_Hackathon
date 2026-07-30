import type { ClaimEdge } from "../lib/contracts/evidence";
import type {
  DealUnderwritingSelectionView,
} from "../lib/underwriting/read-model";

export type PublicCandidateVersionSnapshot = {
  fundPolicyId: string;
  benchmarkPackId: string | null;
  benchmarkEntryId: string | null;
  benchmarkDefinitionFingerprint: string | null;
  frameworkPackId: string;
  frameworkPackDefinitionFingerprint: string;
  routerVersion: string;
  criticalEvidenceProfileId: string;
  criticalEvidenceProfileDefinitionFingerprint: string;
  valuationMethodPolicyId: string;
  valuationMethodPolicyDefinitionFingerprint: string;
  decisionPolicyId: string;
  decisionPolicyDefinitionFingerprint: string;
  referenceCatalogFingerprint: string;
  formulaVersions: string[];
  schemaVersion: string;
};

export function orderUnderwritingSelections(
  selections: DealUnderwritingSelectionView[],
): DealUnderwritingSelectionView[] {
  return [...selections].sort((left, right) => {
    const leftRank = left.rank ?? Number.MAX_SAFE_INTEGER;
    const rightRank = right.rank ?? Number.MAX_SAFE_INTEGER;
    return leftRank - rightRank || left.dealId.localeCompare(right.dealId);
  });
}

export function describeUploadState(input: {
  status:
    | "queued"
    | "extracting"
    | "awaiting_confirmation"
    | "confirmed"
    | "ingesting_memory"
    | "ready"
    | "failed";
  failure: string | null;
}): {
  label: string;
  tone: "neutral" | "active" | "warning" | "success" | "error";
  description: string;
  retryable: boolean;
} {
  if (input.status === "confirmed" && input.failure) {
    return {
      label: "Retryable memory failure",
      tone: "warning",
      description: input.failure,
      retryable: true,
    };
  }
  const states = {
    queued: {
      label: "Queued for extraction",
      tone: "active" as const,
      description: "The background worker has not claimed this upload yet.",
      retryable: false,
    },
    extracting: {
      label: "Extracting preview",
      tone: "active" as const,
      description: "The background worker is producing a reviewable preview.",
      retryable: false,
    },
    awaiting_confirmation: {
      label: "Needs confirmation",
      tone: "warning" as const,
      description:
        "Confirm company identity and Deal ownership before promotion.",
      retryable: false,
    },
    confirmed: {
      label: "Confirmed for promotion",
      tone: "active" as const,
      description: "Identity is confirmed and memory promotion is queued.",
      retryable: false,
    },
    ingesting_memory: {
      label: "Promoting confirmed source",
      tone: "active" as const,
      description: "The confirmed source is entering durable Deal memory.",
      retryable: false,
    },
    ready: {
      label: "Ready",
      tone: "success" as const,
      description: "The Deal and Source Revision are durable.",
      retryable: false,
    },
    failed: {
      label: "Terminal extraction failure",
      tone: "error" as const,
      description: input.failure ?? "Document processing failed.",
      retryable: false,
    },
  };
  return states[input.status];
}

export function lineageForClaim(input: {
  claimItemId: string;
  facts: Array<{ id: string; sourceRevisionId: string }>;
  claimEdges: ClaimEdge[];
}): {
  dependencyItemIds: string[];
  sourceRevisionIds: string[];
} {
  const factRevisionById = new Map(
    input.facts.map((fact) => [fact.id, fact.sourceRevisionId]),
  );
  const pending = [input.claimItemId];
  const visited = new Set<string>(pending);
  const dependencyItemIds: string[] = [];
  const sourceRevisionIds = new Set<string>();

  while (pending.length > 0) {
    const claimItemId = pending.shift()!;
    for (const edge of input.claimEdges) {
      if (
        edge.claimItemId !== claimItemId
        || visited.has(edge.dependencyItemId)
      ) continue;
      visited.add(edge.dependencyItemId);
      dependencyItemIds.push(edge.dependencyItemId);
      const revisionId = factRevisionById.get(edge.dependencyItemId);
      if (revisionId) sourceRevisionIds.add(revisionId);
      else pending.push(edge.dependencyItemId);
    }
  }

  return {
    dependencyItemIds,
    sourceRevisionIds: [...sourceRevisionIds].sort(),
  };
}

export function versionRows(
  snapshot: PublicCandidateVersionSnapshot,
): Array<{ label: string; value: string }> {
  return [
    { label: "Policy", value: snapshot.fundPolicyId },
    {
      label: "Benchmark",
      value: snapshot.benchmarkPackId && snapshot.benchmarkEntryId
        ? withFingerprint(
          `${snapshot.benchmarkPackId} · ${snapshot.benchmarkEntryId}`,
          snapshot.benchmarkDefinitionFingerprint,
        )
        : "Unavailable — no compatible benchmark was pinned",
    },
    {
      label: "Framework",
      value: withFingerprint(
        snapshot.frameworkPackId,
        snapshot.frameworkPackDefinitionFingerprint,
      ),
    },
    {
      label: "Research catalog",
      value: snapshot.referenceCatalogFingerprint,
    },
    { label: "Router", value: snapshot.routerVersion },
    {
      label: "Critical Evidence",
      value: withFingerprint(
        snapshot.criticalEvidenceProfileId,
        snapshot.criticalEvidenceProfileDefinitionFingerprint,
      ),
    },
    {
      label: "Valuation Method",
      value: withFingerprint(
        snapshot.valuationMethodPolicyId,
        snapshot.valuationMethodPolicyDefinitionFingerprint,
      ),
    },
    {
      label: "Decision",
      value: withFingerprint(
        snapshot.decisionPolicyId,
        snapshot.decisionPolicyDefinitionFingerprint,
      ),
    },
    {
      label: "Formula",
      value: snapshot.formulaVersions.length
        ? snapshot.formulaVersions.join(" · ")
        : "Unavailable",
    },
    { label: "Model", value: "Not exposed by server" },
    { label: "Prompt", value: "Not exposed by server" },
    { label: "Schema", value: snapshot.schemaVersion },
    { label: "Settings", value: "Not exposed by server" },
    { label: "Application commit", value: "Not exposed by server" },
  ];
}

function withFingerprint(
  id: string,
  fingerprint: string | null,
): string {
  return fingerprint ? `${id} · ${fingerprint}` : id;
}
