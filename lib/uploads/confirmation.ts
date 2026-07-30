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
  if (!structured?.field.trim() || !structured.value.trim()) return null;
  const excerpt = fact.excerpt?.trim();
  if (!excerpt || !excerpt.toLowerCase().includes(
    structured.value.trim().toLowerCase(),
  )) {
    return null;
  }
  const normalizedField = structured.field.toLowerCase()
    .replace(/[_/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (
    ["pmf", "product market fit", "product-market fit"].includes(
      normalizedField,
    )
  ) {
    return null;
  }
  const financialField = [
    "annual recurring revenue",
    "arr",
    "sales pipeline",
    "pipeline",
    "gross merchandise value",
    "gmv",
    "total revenue",
    "revenue",
    "recurring revenue",
    "subscription revenue",
    "professional services revenue",
    "services revenue",
    "pass through revenue",
    "pass-through revenue",
    "pre money valuation",
    "pre-money valuation",
    "post money valuation",
    "post-money valuation",
    "reported valuation",
    "round price",
  ].includes(normalizedField);
  if (
    (financialField || structured.unit?.toLowerCase() === "currency")
    && !/^[A-Z]{3}$/.test(structured.currency ?? "")
  ) {
    return null;
  }
  if (
    [structured.periodStart, structured.periodEnd]
      .some((value) => value !== null && !/^\d{4}-\d{2}-\d{2}$/.test(value))
    || (
      structured.periodStart
      && structured.periodEnd
      && structured.periodEnd < structured.periodStart
    )
    || [structured.publishedAt, structured.eventAt].some((value) =>
      value !== null && !Number.isFinite(Date.parse(value))
    )
  ) {
    return null;
  }
  return structuredClone(structured);
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
