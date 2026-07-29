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
      | { kind: "image"; imageIndex: 0 };
  }>;
  extractionMetadata: {
    extractorId: "plain_text_v1" | "claude_vision_v1";
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
  createdAt: string;
  updatedAt: string;
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
  create(input: CreateUploadedDocumentInput): Promise<UploadedDocumentRecord>;
  list(workspaceId: string): Promise<UploadedDocumentRecord[]>;
  get(id: string): Promise<UploadedDocumentRecord | null>;
  findByChecksum(workspaceId: string, checksum: string): Promise<UploadedDocumentRecord | null>;
  claimNext(workerId: string): Promise<UploadedDocumentRecord | null>;
  savePreview(input: { id: string; preview: ExtractionPreview }): Promise<void>;
  fail(id: string, reason: string): Promise<void>;
  deleteAll(workspaceId: string): Promise<void>;
}

const LEASE_MS = 5 * 60_000;

export function createMemoryUploadedDocumentsRepository(options: {
  now?: () => Date;
} = {}): UploadedDocumentsRepository {
  const rows = new Map<string, UploadedDocumentRecord & { leaseExpiresAt: number | null }>();
  const now = options.now ?? (() => new Date());
  return {
    async create(input) {
      const timestamp = now().toISOString();
      const record = {
        ...input,
        status: "queued" as const,
        failureReason: null,
        extractionPreview: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        leaseExpiresAt: null,
      };
      rows.set(input.id, record);
      return strip(record);
    },
    async list(workspaceId) {
      return [...rows.values()]
        .filter((row) => row.workspaceId === workspaceId)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .map(strip);
    },
    async get(id) {
      const row = rows.get(id);
      return row ? strip(row) : null;
    },
    async findByChecksum(workspaceId, checksum) {
      const row = [...rows.values()].find((candidate) =>
        candidate.workspaceId === workspaceId && candidate.checksum === checksum
      );
      return row ? strip(row) : null;
    },
    async claimNext(workerId) {
      const current = now().getTime();
      const row = [...rows.values()]
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .find((candidate) =>
          candidate.status === "queued"
          || (candidate.status === "extracting"
            && (candidate.leaseExpiresAt ?? 0) <= current)
        );
      if (!row) return null;
      row.status = "extracting";
      row.leaseExpiresAt = current + LEASE_MS;
      row.updatedAt = now().toISOString();
      void workerId;
      return strip(row);
    },
    async savePreview(input) {
      const row = rows.get(input.id);
      if (!row) return;
      Object.assign(row, {
        status: "awaiting_confirmation" as const,
        failureReason: null,
        extractionPreview: input.preview,
        leaseExpiresAt: null,
        updatedAt: now().toISOString(),
      });
    },
    async fail(id, reason) {
      const row = rows.get(id);
      if (!row) return;
      row.status = "failed";
      row.failureReason = reason;
      row.leaseExpiresAt = null;
      row.updatedAt = now().toISOString();
    },
    async deleteAll(workspaceId) {
      for (const [key, row] of rows) {
        if (row.workspaceId === workspaceId) rows.delete(key);
      }
    },
  };
}

function strip(
  row: UploadedDocumentRecord & { leaseExpiresAt: number | null },
): UploadedDocumentRecord {
  const record = { ...row } as Partial<typeof row>;
  delete record.leaseExpiresAt;
  return structuredClone(record as UploadedDocumentRecord);
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
  const headers = {
    apikey: options.serviceRoleKey,
    authorization: `Bearer ${options.serviceRoleKey}`,
    "content-type": "application/json",
  };
  async function request(path: string, init: RequestInit = {}) {
    const response = await fetchImpl(`${base}${path}`, {
      ...init,
      headers: { ...headers, ...(init.headers ?? {}) },
      cache: "no-store",
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`PostgreSQL gateway ${response.status}: ${detail.slice(0, 240)}`);
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
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }
  return {
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
          status: "queued",
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
    async get(id) {
      const rows = await request(
        `/uploaded_documents?id=eq.${encodeURIComponent(id)}&limit=1`,
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
      const stale = new Date(now().getTime() - LEASE_MS).toISOString();
      const candidates = await request(
        "/uploaded_documents?or=(status.eq.queued,"
        + `and(status.eq.extracting,lease_expires_at.lt.${encodeURIComponent(stale)}))`
        + "&order=created_at.asc&limit=1",
      ) as Record<string, unknown>[];
      const candidate = candidates[0];
      if (!candidate) return null;
      const leaseExpiresAt = new Date(now().getTime() + LEASE_MS).toISOString();
      const claimed = await request(
        `/uploaded_documents?id=eq.${encodeURIComponent(String(candidate.id))}`
        + `&status=eq.${encodeURIComponent(String(candidate.status))}`,
        {
          method: "PATCH",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({
            status: "extracting",
            worker_id: workerId,
            lease_expires_at: leaseExpiresAt,
            updated_at: now().toISOString(),
          }),
        },
      ) as Record<string, unknown>[];
      return claimed[0] ? toRecord(claimed[0]) : null;
    },
    async savePreview(input) {
      await request(`/uploaded_documents?id=eq.${encodeURIComponent(input.id)}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          status: "awaiting_confirmation",
          failure_reason: null,
          extraction_preview: input.preview,
          lease_expires_at: null,
          updated_at: now().toISOString(),
        }),
      });
    },
    async fail(id, reason) {
      await request(`/uploaded_documents?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          status: "failed",
          failure_reason: reason.slice(0, 400),
          lease_expires_at: null,
          updated_at: now().toISOString(),
        }),
      });
    },
    async deleteAll(workspaceId) {
      await request(
        `/uploaded_documents?workspace_id=eq.${encodeURIComponent(workspaceId)}`,
        { method: "DELETE", headers: { Prefer: "return=minimal" } },
      );
    },
  };
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
