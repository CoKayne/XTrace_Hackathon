import {
  SourceRevisionSchema,
  type SourceRevision,
} from "../../lib/contracts/evidence";
import {
  IntegrationTransportError,
  isRetryableTransportStatus,
} from "../../lib/api/errors";

export type { SourceRevision };

export interface CreateSourceRevisionInput {
  id: string;
  workspaceId: string;
  sourceId: string;
  contentHash: string;
  objectKey: string;
  objectVersion: string;
  contentType: string;
  extractorId: string;
  extractorVersion: string;
  extractedAt: string;
  createdAt: string;
}

export interface AppendSourceRevisionInput
  extends CreateSourceRevisionInput {
  supersedesRevisionId: string;
}

export type SourceRevisionAnnotationKind =
  | "retracted"
  | "identity_corrected"
  | "superseded";

export interface SourceRevisionAnnotation {
  id: string;
  workspaceId: string;
  revisionId: string;
  kind: SourceRevisionAnnotationKind;
  reason: string;
  supersededByRunId: string | null;
  createdAt: string;
}

export interface SourceRegistry {
  createInitialRevision(
    input: CreateSourceRevisionInput,
  ): Promise<SourceRevision>;
  appendRevision(input: AppendSourceRevisionInput): Promise<SourceRevision>;
  getRevision(input: {
    workspaceId: string;
    revisionId: string;
  }): Promise<SourceRevision | null>;
  annotateRevision(input: {
    workspaceId: string;
    revisionId: string;
    kind: SourceRevisionAnnotationKind;
    reason: string;
    supersededByRunId: string | null;
  }): Promise<void>;
  listAnnotations(input: {
    workspaceId: string;
    revisionId: string;
  }): Promise<SourceRevisionAnnotation[]>;
}

export interface MemorySourceRegistry extends SourceRegistry {
  captureAtomicState(): unknown;
  restoreAtomicState(state: unknown): void;
  inspect(): {
    revisions: SourceRevision[];
    annotations: SourceRevisionAnnotation[];
  };
}

function requiredText(value: string, label: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function requiredWorkspaceId(workspaceId: string): string {
  return requiredText(workspaceId, "A workspace");
}

function identity(workspaceId: string, externalId: string): string {
  return JSON.stringify([requiredWorkspaceId(workspaceId), externalId]);
}

function sourceIdentity(workspaceId: string, sourceId: string): string {
  return identity(workspaceId, requiredText(sourceId, "A source id"));
}

function validatedInput(
  input: CreateSourceRevisionInput,
): CreateSourceRevisionInput {
  const candidate = {
    ...input,
    id: requiredText(input.id, "A revision id"),
    workspaceId: requiredWorkspaceId(input.workspaceId),
    sourceId: requiredText(input.sourceId, "A source id"),
    contentHash: requiredText(input.contentHash, "A content hash"),
    objectKey: requiredText(input.objectKey, "An object key"),
    objectVersion: requiredText(input.objectVersion, "An object version"),
    contentType: requiredText(input.contentType, "A content type"),
    extractorId: requiredText(input.extractorId, "An extractor id"),
    extractorVersion: requiredText(
      input.extractorVersion,
      "An extractor version",
    ),
  };
  SourceRevisionSchema.parse({
    ...candidate,
    revision: 1,
    supersedesRevisionId: null,
  });
  return candidate;
}

function equalRevision(
  left: SourceRevision,
  right: SourceRevision,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function revisionMatchesInput(
  revision: SourceRevision,
  input: AppendSourceRevisionInput,
): boolean {
  return revision.id === input.id
    && revision.workspaceId === input.workspaceId
    && revision.sourceId === input.sourceId
    && revision.contentHash === input.contentHash
    && revision.objectKey === input.objectKey
    && revision.objectVersion === input.objectVersion
    && revision.contentType === input.contentType
    && revision.extractorId === input.extractorId
    && revision.extractorVersion === input.extractorVersion
    && revision.extractedAt === input.extractedAt
    && revision.supersedesRevisionId === input.supersedesRevisionId
    && revision.createdAt === input.createdAt;
}

export function createMemorySourceRegistry(): MemorySourceRegistry {
  const revisions = new Map<string, SourceRevision>();
  const revisionIdsBySource = new Map<string, string[]>();
  const annotations: SourceRevisionAnnotation[] = [];
  let annotationSequence = 0;

  return {
    captureAtomicState() {
      return {
        revisions: structuredClone([...revisions.entries()]),
        revisionIdsBySource: structuredClone([
          ...revisionIdsBySource.entries(),
        ]),
        annotations: structuredClone(annotations),
        annotationSequence,
      };
    },

    restoreAtomicState(rawState) {
      const state = rawState as {
        revisions: Array<[string, SourceRevision]>;
        revisionIdsBySource: Array<[string, string[]]>;
        annotations: SourceRevisionAnnotation[];
        annotationSequence: number;
      };
      revisions.clear();
      for (const [key, revision] of state.revisions) {
        revisions.set(key, structuredClone(revision));
      }
      revisionIdsBySource.clear();
      for (const [key, ids] of state.revisionIdsBySource) {
        revisionIdsBySource.set(key, structuredClone(ids));
      }
      annotations.splice(0, annotations.length, ...structuredClone(
        state.annotations,
      ));
      annotationSequence = state.annotationSequence;
    },

    async createInitialRevision(rawInput) {
      const input = validatedInput(rawInput);
      const key = sourceIdentity(input.workspaceId, input.sourceId);
      const existingIds = revisionIdsBySource.get(key) ?? [];
      const candidate = SourceRevisionSchema.parse({
        ...input,
        revision: 1,
        supersedesRevisionId: null,
      });
      if (existingIds.length > 0) {
        const existing = revisions.get(
          identity(input.workspaceId, existingIds[0]),
        )!;
        if (equalRevision(existing, candidate)) {
          return structuredClone(existing);
        }
        throw new Error(
          "Source revision 1 is immutable and already contains different data.",
        );
      }
      const revisionKey = identity(input.workspaceId, input.id);
      if (revisions.has(revisionKey)) {
        throw new Error(
          `Revision id ${input.id} already belongs to another source in this workspace.`,
        );
      }
      revisions.set(revisionKey, structuredClone(candidate));
      revisionIdsBySource.set(key, [candidate.id]);
      return structuredClone(candidate);
    },

    async appendRevision(rawInput) {
      const input = {
        ...validatedInput(rawInput),
        supersedesRevisionId: requiredText(
          rawInput.supersedesRevisionId,
          "A superseded revision id",
        ),
      };
      const sourceKey = sourceIdentity(input.workspaceId, input.sourceId);
      const currentIds = revisionIdsBySource.get(sourceKey) ?? [];
      if (currentIds.length === 0) {
        throw new Error(
          "An initial source revision is required before an append.",
        );
      }
      const revisionKey = identity(input.workspaceId, input.id);
      const existingTarget = revisions.get(revisionKey);
      if (existingTarget) {
        if (revisionMatchesInput(existingTarget, input)) {
          return structuredClone(existingTarget);
        }
        throw new Error(
          `Revision id ${input.id} is immutable and already contains different data.`,
        );
      }
      const currentId = currentIds.at(-1)!;
      if (input.supersedesRevisionId !== currentId) {
        throw new Error(
          "A source append must supersede the exact current previous revision.",
        );
      }
      const current = revisions.get(identity(input.workspaceId, currentId))!;
      if (current.sourceId !== input.sourceId) {
        throw new Error(
          "The superseded revision belongs to a different source.",
        );
      }
      const candidate = SourceRevisionSchema.parse({
        ...input,
        revision: current.revision + 1,
      });
      revisions.set(revisionKey, structuredClone(candidate));
      revisionIdsBySource.set(sourceKey, [...currentIds, candidate.id]);
      return structuredClone(candidate);
    },

    async getRevision({ workspaceId, revisionId }) {
      const revision = revisions.get(
        identity(workspaceId, requiredText(revisionId, "A revision id")),
      );
      return revision ? structuredClone(revision) : null;
    },

    async annotateRevision(input) {
      const workspaceId = requiredWorkspaceId(input.workspaceId);
      const revisionId = requiredText(input.revisionId, "A revision id");
      if (!revisions.has(identity(workspaceId, revisionId))) {
        throw new Error(
          "The source revision does not exist in this workspace.",
        );
      }
      const reason = requiredText(input.reason, "An annotation reason");
      if (
        !["retracted", "identity_corrected", "superseded"].includes(input.kind)
      ) {
        throw new Error("The source revision annotation kind is invalid.");
      }
      annotationSequence += 1;
      annotations.push({
        id: `source_annotation_${annotationSequence}`,
        workspaceId,
        revisionId,
        kind: input.kind,
        reason,
        supersededByRunId: input.supersededByRunId,
        createdAt: new Date().toISOString(),
      });
    },

    async listAnnotations({ workspaceId, revisionId }) {
      workspaceId = requiredWorkspaceId(workspaceId);
      revisionId = requiredText(revisionId, "A revision id");
      return annotations
        .filter((annotation) =>
          annotation.workspaceId === workspaceId
          && annotation.revisionId === revisionId
        )
        .map((annotation) => structuredClone(annotation));
    },

    inspect() {
      return {
        revisions: [...revisions.values()].map((revision) =>
          structuredClone(revision)
        ),
        annotations: annotations.map((annotation) =>
          structuredClone(annotation)
        ),
      };
    },
  };
}

function revisionFromRow(row: Record<string, unknown>): SourceRevision {
  return SourceRevisionSchema.parse({
    id: row.id,
    workspaceId: row.workspace_id,
    sourceId: row.source_id,
    revision: Number(row.revision),
    contentHash: row.content_hash,
    objectKey: row.object_key,
    objectVersion: row.object_version,
    contentType: row.content_type,
    extractorId: row.extractor_id,
    extractorVersion: row.extractor_version,
    extractedAt: row.extracted_at,
    supersedesRevisionId: row.supersedes_revision_id,
    createdAt: row.created_at,
  });
}

function annotationFromRow(
  row: Record<string, unknown>,
): SourceRevisionAnnotation {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    revisionId: String(row.revision_id),
    kind: String(row.kind) as SourceRevisionAnnotationKind,
    reason: String(row.reason),
    supersededByRunId: row.superseded_by_run_id
      ? String(row.superseded_by_run_id)
      : null,
    createdAt: String(row.created_at),
  };
}

export function createSupabaseSourceRegistry(options: {
  url: string;
  serviceRoleKey: string;
  fetchImpl?: typeof fetch;
}): SourceRegistry {
  const base = `${options.url.replace(/\/$/, "")}/rest/v1`;
  const fetchImpl = options.fetchImpl ?? fetch;
  const headers = {
    apikey: options.serviceRoleKey,
    authorization: `Bearer ${options.serviceRoleKey}`,
    "content-type": "application/json",
  };
  async function request(
    pathname: string,
    init: RequestInit = {},
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await fetchImpl(`${base}${pathname}`, {
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
    const body = await response.text();
    return body.trim() ? JSON.parse(body) : null;
  }
  async function revisionRpc(
    name: "create_initial_source_revision" | "append_source_revision",
    input: CreateSourceRevisionInput | AppendSourceRevisionInput,
  ): Promise<SourceRevision> {
    const payload = name === "append_source_revision"
      ? {
          ...validatedInput(input),
          supersedesRevisionId: requiredText(
            (input as AppendSourceRevisionInput).supersedesRevisionId,
            "A superseded revision id",
          ),
        }
      : validatedInput(input);
    const rows = await request(`/rpc/${name}`, {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ p_revision: payload }),
    }) as Record<string, unknown>[];
    if (!rows[0]) throw new Error("The source revision RPC returned no row.");
    return revisionFromRow(rows[0]);
  }
  return {
    createInitialRevision: (input) =>
      revisionRpc("create_initial_source_revision", input),
    appendRevision: (input) =>
      revisionRpc("append_source_revision", input),
    async getRevision({ workspaceId, revisionId }) {
      workspaceId = requiredWorkspaceId(workspaceId);
      revisionId = requiredText(revisionId, "A revision id");
      const query = new URLSearchParams({
        workspace_id: `eq.${workspaceId}`,
        id: `eq.${revisionId}`,
        limit: "1",
      });
      const rows = await request(
        `/source_revisions?${query}`,
      ) as Record<string, unknown>[];
      return rows[0] ? revisionFromRow(rows[0]) : null;
    },
    async annotateRevision(input) {
      const workspaceId = requiredWorkspaceId(input.workspaceId);
      const revisionId = requiredText(input.revisionId, "A revision id");
      const reason = requiredText(input.reason, "An annotation reason");
      await request("/rpc/annotate_source_revision", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          p_annotation: {
            workspaceId,
            revisionId,
            kind: input.kind,
            reason,
            supersededByRunId: input.supersededByRunId,
          },
        }),
      });
    },
    async listAnnotations({ workspaceId, revisionId }) {
      workspaceId = requiredWorkspaceId(workspaceId);
      revisionId = requiredText(revisionId, "A revision id");
      const query = new URLSearchParams({
        workspace_id: `eq.${workspaceId}`,
        revision_id: `eq.${revisionId}`,
        order: "created_at.asc,id.asc",
      });
      const rows = await request(
        `/source_revision_annotations?${query}`,
      ) as Record<string, unknown>[];
      return rows.map(annotationFromRow);
    },
  };
}

let singleton: SourceRegistry | undefined;

export function getSourceRegistry(): SourceRegistry {
  if (singleton) return singleton;
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  singleton = url && serviceRoleKey
    ? createSupabaseSourceRegistry({ url, serviceRoleKey })
    : createMemorySourceRegistry();
  return singleton;
}
