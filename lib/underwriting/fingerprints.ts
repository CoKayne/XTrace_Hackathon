import { createHash } from "node:crypto";

import type { XTraceLineageSnapshot } from "../contracts/underwriting";

export interface ImmutableFingerprintRef {
  id: string;
  fingerprint: string;
}

export interface VersionedRef {
  id: string;
  version: string;
}

export interface BatchFingerprintInput {
  workspaceId: string;
  window: {
    days: 14;
    startsAt: string;
    endsAt: string;
  };
  marketSnapshot: ImmutableFingerprintRef;
  eligibleDealRevisions: Array<{
    dealId: string;
    status: string;
    sourceRevisionIds: string[];
    fingerprint: string;
  }>;
  xtraceLineage: XTraceLineageSnapshot;
  selectedEvents: ImmutableFingerprintRef[];
  matching: {
    providerModel: string;
    promptVersion: string;
    schemaVersion: string;
    scoringPolicyVersion: string;
    selectionPolicyVersion: string;
    judgmentFingerprint: string;
  };
  fundPolicySnapshot: {
    id: string;
    version: number;
    fingerprint: string;
  };
  frameworkPack: VersionedRef;
  routerVersion: string;
  decisionPolicy: VersionedRef;
}

export interface CandidateFingerprintInput {
  workspaceId: string;
  batchInputFingerprint: string;
  dealRevision: {
    dealId: string;
    status: string;
    sourceRevisionIds: string[];
    fingerprint: string;
  };
  evidencePack: {
    id: string;
    version: number;
    sourceRevisionIds: string[];
    fingerprint: string;
  };
  evidenceSourceIds: string[];
  context: {
    id: string;
    contextVersion: string;
    criticalEvidenceProfileId: string;
    benchmarkPackId: string | null;
    valuationMethodPolicyId: string;
    frameworkPackId: string;
    decisionPolicyId: string;
  };
  criticalEvidenceProfile: VersionedRef;
  benchmarkPack: VersionedRef | null;
  valuationMethodPolicy: VersionedRef;
  formulaVersions: string[];
  providerModel: string;
  promptVersion: string;
  schemaVersion: string;
  settingsFingerprint: string;
  applicationCommit: string;
}

export function createBatchInputFingerprint(
  input: BatchFingerprintInput,
): string {
  if (input.window.days !== 14) {
    throw new Error("Underwriting batch fingerprints require a 14-day window.");
  }
  return fingerprint({
    kind: "underwriting-batch-input-v1",
    workspaceId: required(input.workspaceId, "workspaceId"),
    window: {
      days: input.window.days,
      startsAt: required(input.window.startsAt, "window.startsAt"),
      endsAt: required(input.window.endsAt, "window.endsAt"),
    },
    marketSnapshot: normalizedFingerprintRef(input.marketSnapshot),
    eligibleDealRevisions: input.eligibleDealRevisions
      .map((revision) => ({
        dealId: required(revision.dealId, "dealId"),
        status: required(revision.status, "deal status"),
        sourceRevisionIds: sortedUnique(revision.sourceRevisionIds),
        fingerprint: required(revision.fingerprint, "Deal fingerprint"),
      }))
      .sort((left, right) => compareUtf8(left.dealId, right.dealId)),
    xtraceLineage: {
      memoryIds: sortedUnique(input.xtraceLineage.memoryIds),
      sourceRevisionIds: sortedUnique(input.xtraceLineage.sourceRevisionIds),
      sourceIds: sortedUnique(input.xtraceLineage.sourceIds),
      fixtureIds: sortedUnique(input.xtraceLineage.fixtureIds),
      capturedAt: required(
        input.xtraceLineage.capturedAt,
        "XTrace capture time",
      ),
    },
    selectedEvents: input.selectedEvents
      .map(normalizedFingerprintRef)
      .sort((left, right) => compareUtf8(left.id, right.id)),
    matching: normalizedRecord(input.matching),
    fundPolicySnapshot: {
      id: required(input.fundPolicySnapshot.id, "Fund Policy id"),
      version: input.fundPolicySnapshot.version,
      fingerprint: required(
        input.fundPolicySnapshot.fingerprint,
        "Fund Policy fingerprint",
      ),
    },
    frameworkPack: normalizedVersionedRef(input.frameworkPack),
    routerVersion: required(input.routerVersion, "Router version"),
    decisionPolicy: normalizedVersionedRef(input.decisionPolicy),
  });
}

export function createCandidateAnalysisFingerprint(
  input: CandidateFingerprintInput,
): string {
  return fingerprint({
    kind: "candidate-analysis-input-v1",
    workspaceId: required(input.workspaceId, "workspaceId"),
    batchInputFingerprint: required(
      input.batchInputFingerprint,
      "batchInputFingerprint",
    ),
    dealRevision: {
      dealId: required(input.dealRevision.dealId, "Deal id"),
      status: required(input.dealRevision.status, "Deal status"),
      sourceRevisionIds: sortedUnique(
        input.dealRevision.sourceRevisionIds,
      ),
      fingerprint: required(
        input.dealRevision.fingerprint,
        "Deal revision fingerprint",
      ),
    },
    evidencePack: {
      id: required(input.evidencePack.id, "Evidence Pack id"),
      version: input.evidencePack.version,
      sourceRevisionIds: sortedUnique(
        input.evidencePack.sourceRevisionIds,
      ),
      fingerprint: required(
        input.evidencePack.fingerprint,
        "Evidence Pack fingerprint",
      ),
    },
    evidenceSourceIds: sortedUnique(input.evidenceSourceIds),
    context: normalizedRecord(input.context),
    criticalEvidenceProfile: normalizedVersionedRef(
      input.criticalEvidenceProfile,
    ),
    benchmarkPack: input.benchmarkPack
      ? normalizedVersionedRef(input.benchmarkPack)
      : null,
    valuationMethodPolicy: normalizedVersionedRef(
      input.valuationMethodPolicy,
    ),
    formulaVersions: sortedUnique(input.formulaVersions),
    providerModel: required(input.providerModel, "Provider model"),
    promptVersion: required(input.promptVersion, "Prompt version"),
    schemaVersion: required(input.schemaVersion, "Schema version"),
    settingsFingerprint: required(
      input.settingsFingerprint,
      "Settings fingerprint",
    ),
    applicationCommit: required(
      input.applicationCommit,
      "Application commit",
    ),
  });
}

export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Fingerprint inputs cannot contain non-finite numbers.");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort(compareUtf8);
    return `{${keys.map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(record[key])}`
    ).join(",")}}`;
  }
  throw new Error(`Unsupported fingerprint input type: ${typeof value}.`);
}

function fingerprint(value: unknown): string {
  return `sha256:${
    createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")
  }`;
}

function normalizedFingerprintRef(
  value: ImmutableFingerprintRef,
): ImmutableFingerprintRef {
  return {
    id: required(value.id, "Snapshot id"),
    fingerprint: required(value.fingerprint, "Snapshot fingerprint"),
  };
}

function normalizedVersionedRef(value: VersionedRef): VersionedRef {
  return {
    id: required(value.id, "Versioned reference id"),
    version: required(value.version, "Versioned reference version"),
  };
}

function normalizedRecord<T extends Record<string, unknown>>(value: T): T {
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") required(item, key);
  }
  return { ...value };
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => required(value, "Set item")))]
    .sort(compareUtf8);
}

function compareUtf8(left: string, right: string): number {
  return Buffer.from(left, "utf8").compare(Buffer.from(right, "utf8"));
}

function required(value: string, label: string): string {
  if (!value || value.trim() !== value) {
    throw new Error(`${label} must be non-empty without surrounding whitespace.`);
  }
  return value;
}
