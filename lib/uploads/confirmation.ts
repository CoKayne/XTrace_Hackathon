import { createHash } from "node:crypto";

import type {
  ExtractionPreview,
  UploadedDocumentRecord,
  UploadedDocumentsRepository,
} from "../../db/repositories/uploaded-documents";
import type {
  DealRegistry,
  RegisteredDeal,
} from "../../db/repositories/deal-registry";
import {
  createMemoryEvidencePacksRepository,
  getEvidencePacksRepository,
  type EvidencePacksRepository,
  type SourceEvidenceInput,
} from "../../db/repositories/evidence-packs";
import type { SourceRegistry } from "../../db/repositories/source-registry";
import type { ConfirmUpload } from "../contracts/http";
import type { DealMemoryBundle, DealStatus } from "../contracts/domain";
import { safeFilename } from "./service";

export interface UploadPreviewDto {
  uploadId: string;
  status: UploadedDocumentRecord["status"];
  filename: string;
  contentType: string;
  preview: {
    candidateCompanyName: string | null;
    candidateHeadline: string | null;
    facts: ExtractionPreview["facts"];
  } | null;
  candidateDeals: Array<{
    dealId: string;
    companyName: string;
    status: DealStatus;
  }>;
  failure: string | null;
}

export type UploadRecoveryFields = {
  dealId: string | null;
  sourceRevisionId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type UploadRecoveryDto =
  & Omit<UploadPreviewDto, "candidateDeals">
  & UploadRecoveryFields;

export type UploadRecoveryDetailDto =
  & UploadPreviewDto
  & UploadRecoveryFields;

export interface ConfirmedUpload {
  uploadId: string;
  dealId: string;
  sourceRevisionId: string;
  status: "confirmed";
}

export class UploadConfirmationNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadConfirmationNotFoundError";
  }
}

export class UploadConfirmationConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadConfirmationConflictError";
  }
}

export function toUploadPreviewDto(
  record: UploadedDocumentRecord,
  candidateDeals: UploadPreviewDto["candidateDeals"],
): UploadPreviewDto {
  return {
    uploadId: record.id,
    status: record.status,
    filename: safeFilename(record.filename),
    contentType: record.contentType,
    preview: record.extractionPreview
      ? {
          candidateCompanyName:
            record.extractionPreview.candidateCompanyName,
          candidateHeadline: record.extractionPreview.candidateHeadline,
          facts: structuredClone(record.extractionPreview.facts),
        }
      : null,
    candidateDeals: structuredClone(candidateDeals),
    failure: record.failureReason ? publicFailure(record.status) : null,
  };
}

export function toUploadRecoveryDto(
  record: UploadedDocumentRecord,
): UploadRecoveryDto {
  const preview = toUploadPreviewDto(record, []);
  return {
    uploadId: preview.uploadId,
    status: preview.status,
    filename: preview.filename,
    contentType: preview.contentType,
    preview: preview.preview,
    failure: preview.failure,
    ...uploadRecoveryFields(record),
  };
}

export function toUploadRecoveryDetailDto(
  record: UploadedDocumentRecord,
  candidateDeals: UploadPreviewDto["candidateDeals"],
): UploadRecoveryDetailDto {
  return {
    ...toUploadPreviewDto(record, candidateDeals),
    ...uploadRecoveryFields(record),
  };
}

function uploadRecoveryFields(
  record: UploadedDocumentRecord,
): UploadRecoveryFields {
  return {
    dealId: record.dealId ?? null,
    sourceRevisionId: record.sourceRevisionId ?? null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function createUploadConfirmationService(dependencies: {
  uploads: UploadedDocumentsRepository;
  sources: SourceRegistry;
  deals: DealRegistry;
  evidencePacks?: EvidencePacksRepository;
  now?: () => Date;
}) {
  const now = dependencies.now ?? (() => new Date());
  const evidencePacks = dependencies.evidencePacks
    ?? (
      dependencies.uploads.promoteAtomically
        ? getEvidencePacksRepository()
        : createMemoryEvidencePacksRepository()
    );

  return {
    async listCandidateDeals(workspaceId: string) {
      return (await dependencies.deals.listForWorkspace(workspaceId)).map(
        toCandidateDeal,
      );
    },

    async confirm(input: {
      workspaceId: string;
      uploadId: string;
      assignedByUserId: string;
      choice: ConfirmUpload;
    }): Promise<ConfirmedUpload> {
      return dependencies.uploads.withConfirmationLock({
        workspaceId: input.workspaceId,
        uploadId: input.uploadId,
      }, async () => {
        const upload = await dependencies.uploads.get({
          workspaceId: input.workspaceId,
          id: input.uploadId,
        });
        if (!upload) {
          throw new UploadConfirmationNotFoundError(
            "Upload was not found.",
          );
        }
        if (!upload.extractionPreview) {
          throw new UploadConfirmationConflictError(
            "The upload is not awaiting confirmation.",
          );
        }
        if (upload.extractionPreview.facts.length === 0) {
          throw new UploadConfirmationConflictError(
            "Confirmation requires at least one source-backed fact.",
          );
        }

        const identity = await resolveDealIdentity({
          workspaceId: input.workspaceId,
          upload,
          choice: input.choice,
          deals: dependencies.deals,
        });
        const sourceId = stableId("source", [
          input.workspaceId,
          upload.id,
          upload.checksum,
        ]);
        const sourceRevisionId = stableId("revision", [
          input.workspaceId,
          upload.id,
          upload.checksum,
        ]);
        const confirmationFingerprint = fingerprint([
          "upload-confirmation-v1",
          input.workspaceId,
          upload.id,
          upload.checksum,
          identity.dealId,
          identity.companyId,
          identity.companyName,
          identity.status,
        ]);
        if (upload.confirmationFingerprint) {
          if (upload.confirmationFingerprint !== confirmationFingerprint) {
            throw new UploadConfirmationConflictError(
              "The upload was already confirmed with a different confirmation.",
            );
          }
          return {
            uploadId: upload.id,
            dealId: upload.dealId!,
            sourceRevisionId: upload.sourceRevisionId!,
            status: "confirmed",
          };
        }
        if (upload.status !== "awaiting_confirmation") {
          throw new UploadConfirmationConflictError(
            "The upload is not awaiting confirmation.",
          );
        }

        const confirmedAt = now().toISOString();
        const evidence = upload.extractionPreview.facts.map((fact, index) => ({
          id: `evidence_${sourceRevisionId}_${index}`,
          fact: fact.text,
          excerpt: fact.excerpt ?? fact.text,
          page: 1,
          locator: evidenceLocator(fact),
          structured: completeStructuredFact(fact),
        }));
        const canonicalEvidence = evidence.map((item) =>
          canonicalSourceEvidence({
            item,
            workspaceId: input.workspaceId,
            dealId: identity.dealId,
            sourceId,
            sourceRevisionId,
            retrievedAt:
              upload.extractionPreview!.extractionMetadata.extractedAt,
          })
        );
        const bundle = memoryBundle({
          upload,
          dealId: identity.dealId,
          companyName: identity.companyName,
          status: identity.status,
          sourceId,
          sourceRevisionId,
        });
        const memoryLineage = {
          evidence: Object.fromEntries(bundle.facts.flatMap((fact) =>
            fact.sources.map((source) => [source.id, {
              workspaceId: input.workspaceId,
              dealId: identity.dealId,
              sourceId,
              sourceRevisionId,
            }])
          )),
          interactions: {},
        };
        const assignmentRequestId =
          `upload-confirmation:${upload.id}:${upload.checksum}`;
        const revisionInput = {
            id: sourceRevisionId,
            workspaceId: input.workspaceId,
            sourceId,
            contentHash: upload.checksum,
            objectKey: upload.objectKey,
            objectVersion: upload.checksum,
            contentType: upload.contentType,
            extractorId:
              upload.extractionPreview!.extractionMetadata.extractorId,
            extractorVersion:
              upload.extractionPreview!.extractionMetadata.extractorVersion,
            extractedAt:
              upload.extractionPreview!.extractionMetadata.extractedAt,
            createdAt: confirmedAt,
          };
        const createRevision = (
          createInitialRevision: SourceRegistry["createInitialRevision"] =
            dependencies.sources.createInitialRevision.bind(
              dependencies.sources,
            ),
        ) => createInitialRevision(revisionInput);
        const confirmAssignment = (
          revisionId: string,
          confirmSourceAssignment: DealRegistry["confirmSourceAssignment"],
        ) =>
          confirmSourceAssignment({
            requestId: assignmentRequestId,
            workspaceId: input.workspaceId,
            dealId: identity.dealId,
            companyId: identity.companyId,
            companyName: identity.companyName,
            status: identity.status,
            sourceRevisionId: revisionId,
            assignedByUserId: input.assignedByUserId,
            reason:
              "User confirmed runtime upload identity and Deal assignment.",
            confirmedAt,
            memoryBundle: bundle,
            memoryLineage,
          });
        const markUploadConfirmed = () =>
          dependencies.uploads.markConfirmed({
            workspaceId: input.workspaceId,
            id: upload.id,
            confirmationFingerprint,
            dealId: identity.dealId,
            sourceId,
            sourceRevisionId,
          });
        if (dependencies.uploads.promoteAtomically) {
          await dependencies.uploads.promoteAtomically({
            workspaceId: input.workspaceId,
            uploadId: upload.id,
            confirmationFingerprint,
            dealId: identity.dealId,
            companyId: identity.companyId,
            companyName: identity.companyName,
            dealStatus: identity.status,
            sourceId,
            sourceRevisionId,
            assignedByUserId: input.assignedByUserId,
            confirmedAt,
            evidence,
          });
        } else {
          await promoteMemoryAtomically(
            { ...dependencies, evidencePacks },
            {
              upload: {
                workspaceId: input.workspaceId,
                uploadId: upload.id,
              },
              source: {
                workspaceId: input.workspaceId,
                sourceId,
                sourceRevisionId,
              },
              deal: {
                workspaceId: input.workspaceId,
                dealId: identity.dealId,
                companyId: identity.companyId,
                sourceId,
                sourceRevisionId,
                requestId: assignmentRequestId,
              },
              evidence: {
                workspaceId: input.workspaceId,
                evidenceIds: canonicalEvidence.map(({ id }) => id),
              },
            },
            {
              createRevision,
              confirmAssignment,
              putSourceEvidence: () =>
                evidencePacks.putSourceEvidence(canonicalEvidence),
              markUploadConfirmed,
            },
          );
        }
        return {
          uploadId: upload.id,
          dealId: identity.dealId,
          sourceRevisionId,
          status: "confirmed",
        };
      });
    },
  };
}

function evidenceLocator(
  fact: ExtractionPreview["facts"][number],
): SourceEvidenceInput["locator"] {
  if (fact.locator.kind === "image") {
    return {
      kind: "image",
      imageIndex: fact.locator.imageIndex,
      region: null,
    };
  }
  return {
    ...fact.locator,
    excerpt: fact.excerpt ?? fact.text,
  };
}

function completeStructuredFact(
  fact: ExtractionPreview["facts"][number],
): NonNullable<typeof fact.structured> | null {
  const structured = fact.structured;
  const field = trimStructuredText(structured?.field ?? "");
  const value = trimStructuredText(structured?.value ?? "");
  if (!structured || !field || !value) return null;
  const excerpt = trimStructuredText(fact.excerpt ?? "");
  if (
    !excerpt
    || !sourceContains(excerpt, field)
    || !sourceContains(excerpt, value)
  ) {
    return null;
  }
  const category = STRUCTURED_FIELD_CATEGORIES[
    normalizedStructuredField(field)
  ];
  if (!category) return null;

  const unit = trimStructuredText(structured.unit ?? "").toLowerCase()
    || null;
  const currency = trimStructuredText(structured.currency ?? "") || null;
  if (category === "currency") {
    if (
      unit !== "currency"
      || currency !== "USD"
      || !sourceContains(excerpt, currency)
      || !SUPPORTED_CURRENCY_VALUE.test(value)
    ) {
      return null;
    }
  } else if (category === "rate") {
    if (
      unit !== "percent"
      || currency !== null
      || !SUPPORTED_RATE_VALUE.test(value)
      || (
        !value.endsWith("%")
        && !sourceContains(excerpt, "percent")
      )
    ) {
      return null;
    }
  } else if (unit !== null || currency !== null) {
    return null;
  }

  const periodStart = trimStructuredText(structured.periodStart ?? "")
    || null;
  const periodEnd = trimStructuredText(structured.periodEnd ?? "") || null;
  if (
    (periodStart === null) !== (periodEnd === null)
    || (
      periodStart !== null
      && periodEnd !== null
      && (
        !isStrictIsoDate(periodStart)
        || !isStrictIsoDate(periodEnd)
        || periodEnd < periodStart
        || !sourceContains(excerpt, periodStart)
        || !sourceContains(excerpt, periodEnd)
      )
    )
  ) {
    return null;
  }

  const publishedAt = trimStructuredText(structured.publishedAt ?? "")
    || null;
  const eventAt = trimStructuredText(structured.eventAt ?? "") || null;
  if (
    [publishedAt, eventAt].some((timestamp) =>
      timestamp !== null
      && (
        !isStrictIsoTimestamp(timestamp)
        || !sourceContains(excerpt, timestamp)
      )
    )
  ) {
    return null;
  }

  return {
    field,
    value,
    unit,
    currency,
    periodStart,
    periodEnd,
    publishedAt,
    eventAt,
  };
}

type StructuredFieldCategory = "currency" | "rate" | "text";

// Formal upload evidence is deliberately closed over fields and units that
// downstream normalization and valuation can consume without inference.
const STRUCTURED_FIELD_CATEGORIES: Readonly<
  Record<string, StructuredFieldCategory>
> = Object.freeze({
  "annual recurring revenue": "currency",
  arr: "currency",
  "sales pipeline": "currency",
  pipeline: "currency",
  "gross merchandise value": "currency",
  gmv: "currency",
  "total revenue": "currency",
  revenue: "currency",
  "recurring revenue": "currency",
  "subscription revenue": "currency",
  "professional services revenue": "currency",
  "services revenue": "currency",
  "pass through revenue": "currency",
  "pre money valuation": "currency",
  "post money valuation": "currency",
  "reported valuation": "currency",
  "round price": "currency",
  "yoy growth": "rate",
  "year over year growth": "rate",
  growth: "rate",
  "company identity": "text",
  "company id": "text",
  "valuation basis": "text",
  stage: "text",
  "business model": "text",
  geography: "text",
  "security type": "text",
});

const DECIMAL_SOURCE_VALUE =
  "(?:(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d*)?|\\.\\d+)";
const SUPPORTED_CURRENCY_VALUE = new RegExp(
  `^(?:[+-]?\\$?${DECIMAL_SOURCE_VALUE}`
    + `(?:[\\u0009-\\u000d\\u0020]*USD)?`
    + `|\\(\\$?${DECIMAL_SOURCE_VALUE}`
    + `(?:[\\u0009-\\u000d\\u0020]*USD)?\\))$`,
);
const SUPPORTED_RATE_VALUE = new RegExp(
  `^[+-]?${DECIMAL_SOURCE_VALUE}%?$`,
);
const STRICT_ISO_TIMESTAMP =
  /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:0\d|1[0-3]):[0-5]\d|[+-]14:00)$/;

function normalizedStructuredField(value: string): string {
  return value.toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function trimStructuredText(value: string): string {
  return value.replace(
    /^[\u0009-\u000d\u0020]+|[\u0009-\u000d\u0020]+$/g,
    "",
  );
}

function sourceContains(source: string, exactValue: string): boolean {
  const normalizedSource = source.toLowerCase();
  const normalizedValue = exactValue.toLowerCase();
  const beginsWithWord = /^[a-z0-9]/.test(normalizedValue);
  const endsWithWord = /[a-z0-9]$/.test(normalizedValue);
  let searchFrom = 0;
  while (searchFrom <= normalizedSource.length) {
    const start = normalizedSource.indexOf(normalizedValue, searchFrom);
    if (start < 0) return false;
    const before = normalizedSource[start - 1] ?? "";
    const after = normalizedSource[start + normalizedValue.length] ?? "";
    if (
      (!beginsWithWord || !/[a-z0-9]/.test(before))
      && (!endsWithWord || !/[a-z0-9]/.test(after))
    ) {
      return true;
    }
    searchFrom = start + 1;
  }
  return false;
}

function isStrictIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000-")) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.valueOf())
    && parsed.toISOString().slice(0, 10) === value;
}

function isStrictIsoTimestamp(value: string): boolean {
  const match = value.match(STRICT_ISO_TIMESTAMP);
  return Boolean(
    match
    && isStrictIsoDate(match[1]!)
    && Number.isFinite(Date.parse(value)),
  );
}

function canonicalSourceEvidence(input: {
  item: {
    id: string;
    fact: string;
    locator: SourceEvidenceInput["locator"];
    structured: NonNullable<
      ExtractionPreview["facts"][number]["structured"]
    > | null;
  };
  workspaceId: string;
  dealId: string;
  sourceId: string;
  sourceRevisionId: string;
  retrievedAt: string;
}): SourceEvidenceInput {
  const structured = input.item.structured;
  return {
    id: input.item.id,
    workspaceId: input.workspaceId,
    dealId: input.dealId,
    sourceId: input.sourceId,
    sourceRevisionId: input.sourceRevisionId,
    provenanceOrigin: "uploaded_document",
    field: structured?.field ?? "unstructured_source_fact",
    value: structured?.value ?? input.item.fact,
    unit: structured?.unit ?? null,
    currency: structured?.currency ?? null,
    periodStart: structured?.periodStart ?? null,
    periodEnd: structured?.periodEnd ?? null,
    publishedAt: structured?.publishedAt ?? null,
    eventAt: structured?.eventAt ?? null,
    retrievedAt: input.retrievedAt,
    locator: input.item.locator,
    sourceRole: "management",
    assertionStatus: "reported",
    verificationMethod: null,
    freshness: "current",
    acceptedForGate: structured !== null,
  };
}

function memoryBundle(input: {
  upload: UploadedDocumentRecord;
  dealId: string;
  companyName: string;
  status: DealStatus;
  sourceId: string;
  sourceRevisionId: string;
}): DealMemoryBundle {
  return {
    dealId: input.dealId,
    companyName: input.companyName,
    status: input.status,
    facts: input.upload.extractionPreview!.facts.map((fact, index) => ({
      text: fact.text,
      sources: [{
        id: `evidence_${input.sourceRevisionId}_${index}`,
        documentId: input.sourceId,
        provenance: "source_document",
        title: safeFilename(input.upload.filename),
        page: 1,
        excerpt: fact.excerpt ?? fact.text,
      }],
    })),
    interactions: [],
  };
}

async function resolveDealIdentity(input: {
  workspaceId: string;
  upload: UploadedDocumentRecord;
  choice: ConfirmUpload;
  deals: DealRegistry;
}): Promise<{
  dealId: string;
  companyId: string;
  companyName: string;
  status: DealStatus;
}> {
  if (input.choice.assignment.kind === "existing_deal") {
    const existing = await input.deals.findForWorkspace({
      workspaceId: input.workspaceId,
      dealId: input.choice.assignment.dealId,
    });
    if (!existing) {
      throw new UploadConfirmationNotFoundError(
        "The selected Deal does not exist in this workspace.",
      );
    }
    if (existing.companyName !== input.choice.companyName) {
      throw new UploadConfirmationConflictError(
        "The confirmed company name does not match the selected Deal.",
      );
    }
    return {
      dealId: existing.id,
      companyId: existing.companyId,
      companyName: existing.companyName,
      status: existing.status,
    };
  }
  const discriminator = [
    input.workspaceId,
    input.upload.id,
    input.upload.checksum,
    input.choice.companyName,
  ];
  return {
    dealId: stableId("deal", discriminator),
    companyId: stableId("company", discriminator),
    companyName: input.choice.companyName,
    status: input.choice.assignment.dealStatus,
  };
}

function toCandidateDeal(deal: RegisteredDeal) {
  return {
    dealId: deal.id,
    companyName: deal.companyName,
    status: deal.status,
  };
}

function stableId(prefix: string, values: string[]): string {
  return `${prefix}_${createHash("sha256")
    .update(JSON.stringify(values), "utf8")
    .digest("hex")
    .slice(0, 24)}`;
}

function fingerprint(values: string[]): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(values), "utf8")
    .digest("hex")}`;
}

function publicFailure(status: UploadedDocumentRecord["status"]): string {
  return status === "confirmed"
    ? "Memory ingestion failed. Retry is available."
    : "Document processing failed.";
}

interface AtomicMemoryAdapter<Scope> {
  capturePromotionState(scope: Scope): unknown;
  restorePromotionState(before: unknown, expected: unknown): void;
}

interface AtomicMemoryDealAdapter<Scope>
  extends AtomicMemoryAdapter<Scope> {
  usesSourceRegistry(registry: SourceRegistry): boolean;
  withPromotionLock<T>(
    scope: { workspaceId: string; dealId: string },
    operation: (
      confirmSourceAssignment: DealRegistry["confirmSourceAssignment"],
    ) => Promise<T>,
  ): Promise<T>;
}

interface AtomicMemorySourceAdapter<Scope>
  extends AtomicMemoryAdapter<Scope> {
  withPromotionLock<T>(
    scope: {
      workspaceId: string;
      sourceId: string;
      sourceRevisionId: string;
    },
    operation: (
      createInitialRevision: SourceRegistry["createInitialRevision"],
    ) => Promise<T>,
  ): Promise<T>;
}

async function promoteMemoryAtomically(
  dependencies: {
    uploads: UploadedDocumentsRepository;
    sources: SourceRegistry;
    deals: DealRegistry;
    evidencePacks: EvidencePacksRepository;
  },
  scopes: {
    upload: { workspaceId: string; uploadId: string };
    source: {
      workspaceId: string;
      sourceId: string;
      sourceRevisionId: string;
    };
    deal: {
      workspaceId: string;
      dealId: string;
      companyId: string;
      sourceId: string;
      sourceRevisionId: string;
      requestId: string;
    };
    evidence: { workspaceId: string; evidenceIds: string[] };
  },
  steps: {
    createRevision: (
      createInitialRevision: SourceRegistry["createInitialRevision"],
    ) => Promise<{ id: string }>;
    confirmAssignment: (
      revisionId: string,
      confirmSourceAssignment: DealRegistry["confirmSourceAssignment"],
    ) => Promise<unknown>;
    putSourceEvidence: () => Promise<void>;
    markUploadConfirmed: () => Promise<unknown>;
  },
): Promise<void> {
  if (
    !isAtomicMemoryAdapter(dependencies.uploads)
    || !isAtomicMemorySourceAdapter(dependencies.sources)
    || !isAtomicMemoryDealAdapter(dependencies.deals)
    || !isAtomicMemoryAdapter(dependencies.evidencePacks)
    || !dependencies.deals.usesSourceRegistry(dependencies.sources)
  ) {
    throw new Error(
      "Atomic upload promotion is unavailable for these repositories.",
    );
  }
  const uploads = dependencies.uploads as UploadedDocumentsRepository
    & AtomicMemoryAdapter<typeof scopes.upload>;
  const sources = dependencies.sources as SourceRegistry
    & AtomicMemorySourceAdapter<typeof scopes.source>;
  const deals = dependencies.deals as DealRegistry
    & AtomicMemoryDealAdapter<typeof scopes.deal>;
  const evidencePacks = dependencies.evidencePacks as EvidencePacksRepository
    & AtomicMemoryAdapter<typeof scopes.evidence>;
  // Every promotion acquires Source before Deal; ordinary mutators acquire
  // at most their owning repository's lock.
  return sources.withPromotionLock(
    scopes.source,
    (createInitialRevision) =>
      deals.withPromotionLock(scopes.deal, async (confirmSourceAssignment) => {
        const beforeUpload = uploads.capturePromotionState(scopes.upload);
        const beforeSource = sources.capturePromotionState(scopes.source);
        const beforeDeal = deals.capturePromotionState(scopes.deal);
        const beforeEvidence =
          evidencePacks.capturePromotionState(scopes.evidence);
        let expectedUpload = beforeUpload;
        let expectedSource = beforeSource;
        let expectedDeal = beforeDeal;
        let expectedEvidence = beforeEvidence;
        try {
          let revision: { id: string };
          try {
            revision = await steps.createRevision(createInitialRevision);
          } finally {
            expectedSource = sources.capturePromotionState(scopes.source);
          }
          try {
            await steps.confirmAssignment(
              revision.id,
              confirmSourceAssignment,
            );
          } finally {
            expectedDeal = deals.capturePromotionState(scopes.deal);
          }
          try {
            await steps.putSourceEvidence();
          } finally {
            expectedEvidence =
              evidencePacks.capturePromotionState(scopes.evidence);
          }
          try {
            await steps.markUploadConfirmed();
          } finally {
            expectedUpload = uploads.capturePromotionState(scopes.upload);
          }
        } catch (error) {
          uploads.restorePromotionState(beforeUpload, expectedUpload);
          evidencePacks.restorePromotionState(
            beforeEvidence,
            expectedEvidence,
          );
          deals.restorePromotionState(beforeDeal, expectedDeal);
          sources.restorePromotionState(beforeSource, expectedSource);
          throw error;
        }
      }),
  );
}

function isAtomicMemoryAdapter(
  value: unknown,
): value is AtomicMemoryAdapter<unknown> {
  return Boolean(
    value
      && typeof value === "object"
      && "capturePromotionState" in value
      && typeof value.capturePromotionState === "function"
      && "restorePromotionState" in value
      && typeof value.restorePromotionState === "function",
  );
}

function isAtomicMemoryDealAdapter(
  value: unknown,
): value is AtomicMemoryDealAdapter<unknown> {
  return isAtomicMemoryAdapter(value)
    && "usesSourceRegistry" in value
    && typeof value.usesSourceRegistry === "function"
    && "withPromotionLock" in value
    && typeof value.withPromotionLock === "function";
}

function isAtomicMemorySourceAdapter(
  value: unknown,
): value is AtomicMemorySourceAdapter<unknown> {
  return isAtomicMemoryAdapter(value)
    && "withPromotionLock" in value
    && typeof value.withPromotionLock === "function";
}
