import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import {
  IntegrationTransportError,
  isRetryableTransportStatus,
} from "../../lib/api/errors";
import type { EvidenceLocator } from "../../lib/contracts/evidence";

export type UploadedDocumentStatus =
  | "queued"
  | "extracting"
  | "awaiting_confirmation"
  | "confirmed"
  | "ingesting_memory"
  | "ready"
  | "failed";

export interface ExtractionPreview {
  candidateCompanyName: string | null;
  candidateHeadline: string | null;
  facts: Array<{
    text: string;
    excerpt: string | null;
    locator:
      | { kind: "text_range"; start: number; end: number }
      | { kind: "pdf_page"; page: number; excerpt: string }
      | { kind: "image"; imageIndex: 0 };
    structured?: {
      field: string;
      value: string;
      unit: string | null;
      currency: string | null;
      periodStart: string | null;
      periodEnd: string | null;
      publishedAt: string | null;
      eventAt: string | null;
    } | null;
  }>;
  extractionMetadata: {
    extractorId:
      | "plain_text_v1"
      | "pdf_text_v1"
      | "docx_text_v1"
      | "claude_vision_v1";
    extractorVersion: "1";
    extractedAt: string;
    contentHash: string;
    inputBytes: number;
    extractedCharacters: number;
    truncated: false;
  };
}

export interface UploadedDocumentRecord {
  id: string;
  workspaceId: string;
  filename: string;
  contentType: string;
  byteSize: number;
  checksum: string;
  objectKey: string;
  status: UploadedDocumentStatus;
  failureReason: string | null;
  extractionPreview: ExtractionPreview | null;
  dealId?: string | null;
  sourceId?: string | null;
  sourceRevisionId?: string | null;
  confirmationFingerprint?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConfirmedUploadEvidenceInput {
  id: string;
  fact: string;
  excerpt: string | null;
  page: number;
  locator: EvidenceLocator;
  structured: NonNullable<
    ExtractionPreview["facts"][number]["structured"]
  > | null;
}

export interface ClaimedUploadedDocument extends UploadedDocumentRecord {
  workerId: string;
  leaseToken: string;
}

export interface CreateUploadedDocumentInput {
  id: string;
  workspaceId: string;
  filename: string;
  contentType: string;
  byteSize: number;
  checksum: string;
  objectKey: string;
}

export interface UploadedDocumentsRepository {
  withConfirmationLock<T>(
    scope: { workspaceId: string; uploadId: string },
    operation: () => Promise<T>,
  ): Promise<T>;
  create(input: CreateUploadedDocumentInput): Promise<UploadedDocumentRecord>;
  list(workspaceId: string): Promise<UploadedDocumentRecord[]>;
  get(input: { workspaceId: string; id: string }): Promise<UploadedDocumentRecord | null>;
  findByChecksum(workspaceId: string, checksum: string): Promise<UploadedDocumentRecord | null>;
  claimNext(workerId: string): Promise<ClaimedUploadedDocument | null>;
  claimNextConfirmed(workerId: string): Promise<ClaimedUploadedDocument | null>;
  renewLease(input: { workspaceId: string; id: string; workerId: string; leaseToken: string }): Promise<boolean>;
  savePreview(input: { workspaceId: string; id: string; workerId: string; leaseToken: string; preview: ExtractionPreview }): Promise<boolean>;
  fail(input: { workspaceId: string; id: string; workerId: string; leaseToken: string; reason: string }): Promise<boolean>;
  markConfirmed(input: {
    workspaceId: string;
    id: string;
    confirmationFingerprint: string;
    dealId: string;
    sourceId: string;
    sourceRevisionId: string;
  }): Promise<UploadedDocumentRecord>;
  promoteAtomically?(input: {
    workspaceId: string;
    uploadId: string;
    confirmationFingerprint: string;
    dealId: string;
    companyId: string;
    companyName: string;
    dealStatus: string;
    sourceId: string;
    sourceRevisionId: string;
    assignedByUserId: string;
    confirmedAt: string;
    evidence: ConfirmedUploadEvidenceInput[];
  }): Promise<UploadedDocumentRecord>;
  completeConfirmed(input: {
    workspaceId: string;
    id: string;
    workerId: string;
    leaseToken: string;
  }): Promise<boolean>;
  failConfirmed(input: {
    workspaceId: string;
    id: string;
    workerId: string;
    leaseToken: string;
    reason: string;
  }): Promise<boolean>;
  deleteAll(workspaceId: string): Promise<void>;
}

export interface MemoryUploadedDocumentsRepository
  extends UploadedDocumentsRepository {
  capturePromotionState(scope: {
    workspaceId: string;
    uploadId: string;
  }): unknown;
  restorePromotionState(before: unknown, expected: unknown): void;
}

const LEASE_MS = 5 * 60_000;

export function createMemoryUploadedDocumentsRepository(options: {
  now?: () => Date;
} = {}): MemoryUploadedDocumentsRepository {
  const rows = new Map<string, UploadedDocumentRecord & {
    leaseExpiresAt: number | null;
    workerId: string | null;
    leaseToken: string | null;
  }>();
  const now = options.now ?? (() => new Date());
  const confirmationLocks = new Map<string, Promise<void>>();
  return {
    withConfirmationLock(scope, operation) {
      return withUploadedDocumentKeyLock(
        confirmationLocks,
        uploadIdentity(scope.workspaceId, scope.uploadId),
        operation,
      );
    },

    capturePromotionState(scope) {
      const key = uploadIdentity(scope.workspaceId, scope.uploadId);
      return {
        key,
        row: rows.has(key) ? structuredClone(rows.get(key)) : null,
      };
    },

    restorePromotionState(rawBefore, rawExpected) {
      type PromotionState = {
        key: string;
        row: (UploadedDocumentRecord & {
          leaseExpiresAt: number | null;
          workerId: string | null;
          leaseToken: string | null;
        }) | null;
      };
      const before = rawBefore as PromotionState;
      const expected = rawExpected as PromotionState;
      if (before.key !== expected.key) {
        throw new Error("Upload promotion states do not share an identity.");
      }
      const current = rows.get(before.key) ?? null;
      if (!isDeepStrictEqual(current, expected.row)) return;
      if (before.row) {
        rows.set(before.key, structuredClone(before.row));
      } else {
        rows.delete(before.key);
      }
    },

    async create(input) {
      const timestamp = now().toISOString();
      const record = {
        ...input,
        status: "queued" as const,
        failureReason: null,
        extractionPreview: null,
        dealId: null,
        sourceId: null,
        sourceRevisionId: null,
        confirmationFingerprint: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        leaseExpiresAt: null,
        workerId: null,
        leaseToken: null,
      };
      rows.set(uploadIdentity(input.workspaceId, input.id), record);
      return strip(record);
    },
    async list(workspaceId) {
      return [...rows.values()]
        .filter((row) => row.workspaceId === workspaceId)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .map(strip);
    },
    async get(input) {
      const row = rows.get(uploadIdentity(input.workspaceId, input.id));
      return row ? strip(row) : null;
    },
    async findByChecksum(workspaceId, checksum) {
      const row = [...rows.values()].find((candidate) =>
        candidate.workspaceId === workspaceId && candidate.checksum === checksum
      );
      return row ? strip(row) : null;
    },
    async claimNext(workerId) {
      return claimMemoryRow(rows, {
        workerId,
        targetStatus: "queued",
        claimedStatus: "extracting",
        now,
      });
    },
    async claimNextConfirmed(workerId) {
      return claimMemoryRow(rows, {
        workerId,
        targetStatus: "confirmed",
        claimedStatus: "ingesting_memory",
        now,
      });
    },
    async renewLease(input) {
      const row = rows.get(uploadIdentity(input.workspaceId, input.id));
      if (
        !row
        || !["extracting", "ingesting_memory"].includes(row.status)
        || row.workerId !== input.workerId
        || row.leaseToken !== input.leaseToken
        || (row.leaseExpiresAt ?? 0) <= now().getTime()
      ) return false;
      row.leaseExpiresAt = now().getTime() + LEASE_MS;
      row.updatedAt = now().toISOString();
      return true;
    },
    async savePreview(input) {
      const row = rows.get(uploadIdentity(input.workspaceId, input.id));
      if (
        !row
        || row.status !== "extracting"
        || row.workerId !== input.workerId
        || row.leaseToken !== input.leaseToken
        || (row.leaseExpiresAt ?? 0) <= now().getTime()
      ) return false;
      Object.assign(row, {
        status: "awaiting_confirmation" as const,
        failureReason: null,
        extractionPreview: input.preview,
        leaseExpiresAt: null,
        workerId: null,
        leaseToken: null,
        updatedAt: now().toISOString(),
      });
      return true;
    },
    async fail(input) {
      const row = rows.get(uploadIdentity(input.workspaceId, input.id));
      if (
        !row
        || row.status !== "extracting"
        || row.workerId !== input.workerId
        || row.leaseToken !== input.leaseToken
        || (row.leaseExpiresAt ?? 0) <= now().getTime()
      ) return false;
      row.status = "failed";
      row.failureReason = input.reason;
      row.leaseExpiresAt = null;
      row.workerId = null;
      row.leaseToken = null;
      row.updatedAt = now().toISOString();
      return true;
    },
    async markConfirmed(input) {
      const row = rows.get(uploadIdentity(input.workspaceId, input.id));
      if (!row) throw new Error("Upload was not found.");
      if (row.confirmationFingerprint) {
        if (row.confirmationFingerprint !== input.confirmationFingerprint) {
          throw new Error("The upload was already confirmed with a different confirmation.");
        }
        return strip(row);
      }
      if (row.status !== "awaiting_confirmation" || !row.extractionPreview) {
        throw new Error("The upload is not awaiting confirmation.");
      }
      Object.assign(row, {
        status: "confirmed" as const,
        failureReason: null,
        dealId: input.dealId,
        sourceId: input.sourceId,
        sourceRevisionId: input.sourceRevisionId,
        confirmationFingerprint: input.confirmationFingerprint,
        updatedAt: now().toISOString(),
      });
      return strip(row);
    },
    async completeConfirmed(input) {
      const row = rows.get(uploadIdentity(input.workspaceId, input.id));
      if (
        !row
        || row.status !== "ingesting_memory"
        || row.workerId !== input.workerId
        || row.leaseToken !== input.leaseToken
        || (row.leaseExpiresAt ?? 0) <= now().getTime()
      ) return false;
      Object.assign(row, {
        status: "ready" as const,
        failureReason: null,
        leaseExpiresAt: null,
        workerId: null,
        leaseToken: null,
        updatedAt: now().toISOString(),
      });
      return true;
    },
    async failConfirmed(input) {
      const row = rows.get(uploadIdentity(input.workspaceId, input.id));
      if (
        !row
        || row.status !== "ingesting_memory"
        || row.workerId !== input.workerId
        || row.leaseToken !== input.leaseToken
        || (row.leaseExpiresAt ?? 0) <= now().getTime()
      ) return false;
      Object.assign(row, {
        status: "confirmed" as const,
        failureReason: input.reason.slice(0, 400),
        leaseExpiresAt: null,
        workerId: null,
        leaseToken: null,
        updatedAt: now().toISOString(),
      });
      return true;
    },
    async deleteAll(workspaceId) {
      for (const [key, row] of rows) {
        if (row.workspaceId === workspaceId) rows.delete(key);
      }
    },
  };
}

function strip(
  row: UploadedDocumentRecord & {
    leaseExpiresAt: number | null;
    workerId: string | null;
    leaseToken: string | null;
  },
): UploadedDocumentRecord {
  const record = { ...row } as Partial<typeof row>;
  delete record.leaseExpiresAt;
  delete record.workerId;
  delete record.leaseToken;
  return structuredClone(record as UploadedDocumentRecord);
}

function claimMemoryRow(
  rows: Map<string, UploadedDocumentRecord & {
    leaseExpiresAt: number | null;
    workerId: string | null;
    leaseToken: string | null;
  }>,
  input: {
    workerId: string;
    targetStatus: "queued" | "confirmed";
    claimedStatus: "extracting" | "ingesting_memory";
    now: () => Date;
  },
): ClaimedUploadedDocument | null {
  const current = input.now().getTime();
  const row = [...rows.values()]
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .find((candidate) =>
      candidate.status === input.targetStatus
      || (
        candidate.status === input.claimedStatus
        && (candidate.leaseExpiresAt ?? 0) <= current
      )
    );
  if (!row) return null;
  const leaseToken = randomUUID();
  row.status = input.claimedStatus;
  row.leaseExpiresAt = current + LEASE_MS;
  row.updatedAt = input.now().toISOString();
  row.workerId = input.workerId;
  row.leaseToken = leaseToken;
  return { ...strip(row), workerId: input.workerId, leaseToken };
}

function uploadIdentity(workspaceId: string, externalId: string): string {
  return JSON.stringify([workspaceId, externalId]);
}

async function withUploadedDocumentKeyLock<T>(
  locks: Map<string, Promise<void>>,
  key: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => current);
  locks.set(key, queued);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (locks.get(key) === queued) locks.delete(key);
  }
}

export function createSupabaseUploadedDocumentsRepository(options: {
  url: string;
  serviceRoleKey: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}): UploadedDocumentsRepository {
  const base = `${options.url.replace(/\/$/, "")}/rest/v1`;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());
  const confirmationLocks = new Map<string, Promise<void>>();
  const headers = {
    apikey: options.serviceRoleKey,
    authorization: `Bearer ${options.serviceRoleKey}`,
    "content-type": "application/json",
  };
  async function request(path: string, init: RequestInit = {}) {
    let response: Response;
    try {
      response = await fetchImpl(`${base}${path}`, {
        ...init,
        headers: { ...headers, ...(init.headers ?? {}) },
        cache: "no-store",
      });
    } catch {
      throw new IntegrationTransportError({ retryable: true });
    }
    if (!response.ok) {
      throw new IntegrationTransportError({
        retryable: isRetryableTransportStatus(response.status),
      });
    }
    if (response.status === 204) return null;
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }
  function toRecord(row: Record<string, unknown>): UploadedDocumentRecord {
    return {
      id: String(row.id),
      workspaceId: String(row.workspace_id),
      filename: String(row.filename),
      contentType: String(row.content_type),
      byteSize: Number(row.byte_size),
      checksum: String(row.checksum),
      objectKey: String(row.object_key),
      status: row.status as UploadedDocumentStatus,
      failureReason: row.failure_reason ? String(row.failure_reason) : null,
      extractionPreview: row.extraction_preview
        ? row.extraction_preview as ExtractionPreview
        : null,
      dealId: row.deal_id ? String(row.deal_id) : null,
      sourceId: row.source_id ? String(row.source_id) : null,
      sourceRevisionId: row.source_revision_id
        ? String(row.source_revision_id)
        : null,
      confirmationFingerprint: row.confirmation_fingerprint
        ? String(row.confirmation_fingerprint)
        : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }
  return {
    withConfirmationLock(scope, operation) {
      return withUploadedDocumentKeyLock(
        confirmationLocks,
        uploadIdentity(scope.workspaceId, scope.uploadId),
        operation,
      );
    },

    async create(input) {
      const rows = await request("/uploaded_documents", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          id: input.id,
          workspace_id: input.workspaceId,
          filename: input.filename,
          content_type: input.contentType,
          byte_size: input.byteSize,
          checksum: input.checksum,
          object_key: input.objectKey,
        }),
      }) as Record<string, unknown>[];
      return toRecord(rows[0]);
    },
    async list(workspaceId) {
      const rows = await request(
        `/uploaded_documents?workspace_id=eq.${encodeURIComponent(workspaceId)}&order=created_at.desc`,
      ) as Record<string, unknown>[];
      return rows.map(toRecord);
    },
    async get(input) {
      const rows = await request(
        `/uploaded_documents?workspace_id=eq.${encodeURIComponent(input.workspaceId)}`
        + `&id=eq.${encodeURIComponent(input.id)}&limit=1`,
      ) as Record<string, unknown>[];
      return rows[0] ? toRecord(rows[0]) : null;
    },
    async findByChecksum(workspaceId, checksum) {
      const rows = await request(
        `/uploaded_documents?workspace_id=eq.${encodeURIComponent(workspaceId)}`
        + `&checksum=eq.${encodeURIComponent(checksum)}&limit=1`,
      ) as Record<string, unknown>[];
      return rows[0] ? toRecord(rows[0]) : null;
    },
    async claimNext(workerId) {
      return claimViaRpc("queued", workerId);
    },
    async claimNextConfirmed(workerId) {
      return claimViaRpc("confirmed", workerId);
    },
    async renewLease(input) {
      const rows = await request("/rpc/renew_uploaded_document_lease", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          p_workspace_id: input.workspaceId,
          p_upload_id: input.id,
          p_worker_id: input.workerId,
          p_lease_token: input.leaseToken,
          p_lease_seconds: Math.floor(LEASE_MS / 1_000),
        }),
      }) as boolean | Array<{ renew_uploaded_document_lease: boolean }>;
      return typeof rows === "boolean"
        ? rows
        : Boolean(rows[0]?.renew_uploaded_document_lease);
    },
    async savePreview(input) {
      return transitionLease({
        ...input,
        transition: "extraction_complete",
        extractionPreview: input.preview,
        failureReason: null,
      });
    },
    async fail(input) {
      return transitionLease({
        ...input,
        transition: "extraction_fail",
        extractionPreview: null,
        failureReason: input.reason,
      });
    },
    async markConfirmed(input) {
      const rows = await request(
        `/uploaded_documents?workspace_id=eq.${encodeURIComponent(input.workspaceId)}`
        + `&id=eq.${encodeURIComponent(input.id)}`
        + "&status=eq.awaiting_confirmation",
        {
          method: "PATCH",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({
            status: "confirmed",
            failure_reason: null,
            deal_id: input.dealId,
            source_id: input.sourceId,
            source_revision_id: input.sourceRevisionId,
            confirmation_fingerprint: input.confirmationFingerprint,
            updated_at: now().toISOString(),
          }),
        },
      ) as Record<string, unknown>[];
      if (rows[0]) return toRecord(rows[0]);
      const existing = await this.get({
        workspaceId: input.workspaceId,
        id: input.id,
      });
      if (
        existing
        && existing.confirmationFingerprint === input.confirmationFingerprint
      ) return existing;
      throw new Error(
        existing?.confirmationFingerprint
          ? "The upload was already confirmed with a different confirmation."
          : "The upload is not awaiting confirmation.",
      );
    },
    async promoteAtomically(input) {
      const value = await request("/rpc/confirm_uploaded_document", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          p_confirmation: input,
        }),
      }) as Record<string, unknown>;
      if (!value?.upload) {
        throw new Error("Upload confirmation RPC returned no upload.");
      }
      return toRecord(value.upload as Record<string, unknown>);
    },
    async completeConfirmed(input) {
      return transitionLease({
        ...input,
        transition: "confirmed_complete",
        extractionPreview: null,
        failureReason: null,
      });
    },
    async failConfirmed(input) {
      return transitionLease({
        ...input,
        transition: "confirmed_fail",
        extractionPreview: null,
        failureReason: input.reason,
      });
    },
    async deleteAll(workspaceId) {
      await request(
        `/uploaded_documents?workspace_id=eq.${encodeURIComponent(workspaceId)}`,
        { method: "DELETE", headers: { Prefer: "return=minimal" } },
      );
    },
  };

  async function claimViaRpc(
    targetStatus: "queued" | "confirmed",
    workerId: string,
  ): Promise<ClaimedUploadedDocument | null> {
    const value = await request("/rpc/claim_next_uploaded_document", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        p_target_status: targetStatus,
        p_worker_id: workerId,
        p_lease_seconds: Math.floor(LEASE_MS / 1_000),
      }),
    }) as Record<string, unknown> | Record<string, unknown>[] | null;
    const row = Array.isArray(value) ? value[0] : value;
    if (!row) return null;
    const leaseToken = String(row.lease_token ?? "");
    if (!leaseToken) {
      throw new Error("Upload claim RPC returned no lease token.");
    }
    return {
      ...toRecord(row),
      workerId,
      leaseToken,
    };
  }

  async function transitionLease(input: {
    workspaceId: string;
    id: string;
    workerId: string;
    leaseToken: string;
    transition:
      | "extraction_complete"
      | "extraction_fail"
      | "confirmed_complete"
      | "confirmed_fail";
    extractionPreview: ExtractionPreview | null;
    failureReason: string | null;
  }): Promise<boolean> {
    const value = await request(
      "/rpc/transition_uploaded_document_lease",
      {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          p_workspace_id: input.workspaceId,
          p_upload_id: input.id,
          p_worker_id: input.workerId,
          p_lease_token: input.leaseToken,
          p_transition: input.transition,
          p_extraction_preview: input.extractionPreview,
          p_failure_reason: input.failureReason?.slice(0, 400) ?? null,
        }),
      },
    ) as boolean | Array<
      boolean | { transition_uploaded_document_lease: boolean }
    >;
    if (typeof value === "boolean") return value;
    const first = value[0];
    return typeof first === "boolean"
      ? first
      : Boolean(first?.transition_uploaded_document_lease);
  }
}

let singleton: UploadedDocumentsRepository | undefined;

export function getUploadedDocumentsRepository(): UploadedDocumentsRepository {
  if (singleton) return singleton;
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  singleton = url && serviceRoleKey
    ? createSupabaseUploadedDocumentsRepository({ url, serviceRoleKey })
    : createMemoryUploadedDocumentsRepository();
  return singleton;
}
