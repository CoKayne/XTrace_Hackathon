import type { Provenance } from "../../lib/contracts/domain";
import {
  IntegrationTransportError,
  isRetryableTransportStatus,
} from "../../lib/api/errors";

export interface XTraceIngestLineage {
  jobId: string;
  workspaceId: string;
  dealId: string;
  sourceRevisionIds: string[];
  sourceIds: string[];
  fixtureIds: string[];
  bundleFingerprint: string;
  serializerVersion: string;
  provenance: Provenance;
  status: "pending" | "running" | "succeeded" | "failed";
  memoryIds: string[];
}

export interface XTraceMemoryLineage {
  memoryId: string;
  workspaceId: string;
  dealId: string;
  sourceRevisionIds: string[];
  sourceIds: string[];
  fixtureIds: string[];
  provenance: Provenance;
}

export interface XTraceLineageRepository {
  recordSubmission(input: Omit<
    XTraceIngestLineage,
    "memoryIds" | "sourceRevisionIds"
  > & { sourceRevisionIds?: string[] }): Promise<void>;
  recordCompletion(input: {
    workspaceId: string;
    jobId: string;
    status: XTraceIngestLineage["status"];
    memoryIds: string[];
  }): Promise<void>;
  listOpenJobs(workspaceId: string): Promise<XTraceIngestLineage[]>;
  findReusableIngest(input: {
    workspaceId: string;
    dealId: string;
    sourceRevisionIds?: string[];
    sourceIds: string[];
    fixtureIds: string[];
    bundleFingerprint: string;
    serializerVersion: string;
  }): Promise<XTraceIngestLineage | null>;
  resolve(input: {
    memoryId: string;
    workspaceId: string;
    convId?: string;
  }): Promise<XTraceMemoryLineage | null>;
}

export function createMemoryXTraceLineageRepository(): XTraceLineageRepository {
  const jobs = new Map<string, XTraceIngestLineage>();
  const memories = new Map<string, XTraceMemoryLineage>();
  return {
    async recordSubmission(input) {
      const key = lineageKey(input.workspaceId, input.jobId);
      const existing = jobs.get(key);
      jobs.set(key, {
        ...structuredClone(input),
        sourceRevisionIds: structuredClone(input.sourceRevisionIds ?? []),
        memoryIds: existing?.memoryIds ?? [],
      });
    },
    async recordCompletion(input) {
      const jobKey = lineageKey(input.workspaceId, input.jobId);
      const job = jobs.get(jobKey);
      if (!job) throw new Error(`XTrace ingest job ${input.jobId} has no local lineage`);
      const next = {
        ...job,
        status: input.status,
        memoryIds: [...new Set(input.memoryIds)],
      };
      jobs.set(jobKey, next);
      for (const memoryId of next.memoryIds) {
        memories.set(lineageKey(input.workspaceId, memoryId), {
          memoryId,
          workspaceId: next.workspaceId,
          dealId: next.dealId,
          sourceRevisionIds: structuredClone(next.sourceRevisionIds),
          sourceIds: structuredClone(next.sourceIds),
          fixtureIds: structuredClone(next.fixtureIds),
          provenance: next.provenance,
        });
      }
    },
    async listOpenJobs(workspaceId) {
      return [...jobs.values()]
        .filter((job) =>
          job.workspaceId === workspaceId
          && (job.status === "pending" || job.status === "running")
        )
        .map((job) => structuredClone(job));
    },
    async findReusableIngest(input) {
      const job = [...jobs.values()].reverse().find((candidate) =>
        candidate.workspaceId === input.workspaceId
        && candidate.dealId === input.dealId
        && candidate.status !== "failed"
        && sameStringSet(
          candidate.sourceRevisionIds,
          input.sourceRevisionIds ?? [],
        )
        && sameStringSet(candidate.sourceIds, input.sourceIds)
        && sameStringSet(candidate.fixtureIds, input.fixtureIds)
        && candidate.bundleFingerprint === input.bundleFingerprint
        && candidate.serializerVersion === input.serializerVersion
      );
      return job ? structuredClone(job) : null;
    },
    async resolve(input) {
      const direct = memories.get(lineageKey(input.workspaceId, input.memoryId));
      if (direct) return structuredClone(direct);
      const dealId = input.convId?.startsWith("deal:")
        ? input.convId.slice("deal:".length)
        : "";
      if (!dealId) return null;
      const job = [...jobs.values()].find((candidate) =>
        candidate.workspaceId === input.workspaceId && candidate.dealId === dealId
      );
      if (
        !job
        || (
          !job.sourceRevisionIds.length
          && !job.sourceIds.length
          && !job.fixtureIds.length
        )
      ) return null;
      return {
        memoryId: input.memoryId,
        workspaceId: input.workspaceId,
        dealId,
        sourceRevisionIds: structuredClone(job.sourceRevisionIds),
        sourceIds: structuredClone(job.sourceIds),
        fixtureIds: structuredClone(job.fixtureIds),
        provenance: job.provenance,
      };
    },
  };
}

export function createSupabaseXTraceLineageRepository(options: {
  url: string;
  serviceRoleKey: string;
  fetchImpl?: typeof fetch;
}): XTraceLineageRepository {
  const base = `${options.url.replace(/\/$/, "")}/rest/v1`;
  const fetchImpl = options.fetchImpl ?? fetch;
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
  function toLineage(row: Record<string, unknown>): XTraceMemoryLineage {
    return {
      memoryId: String(row.memory_id),
      workspaceId: String(row.workspace_id),
      dealId: String(row.deal_id),
      sourceRevisionIds: Array.isArray(row.source_revision_ids)
        ? row.source_revision_ids.map(String)
        : [],
      sourceIds: Array.isArray(row.source_ids) ? row.source_ids.map(String) : [],
      fixtureIds: Array.isArray(row.fixture_ids) ? row.fixture_ids.map(String) : [],
      provenance: row.provenance as Provenance,
    };
  }
  function toIngestLineage(row: Record<string, unknown>): XTraceIngestLineage {
    return {
      jobId: String(row.job_id),
      workspaceId: String(row.workspace_id),
      dealId: String(row.deal_id),
      sourceRevisionIds: Array.isArray(row.source_revision_ids)
        ? row.source_revision_ids.map(String)
        : [],
      sourceIds: Array.isArray(row.source_ids) ? row.source_ids.map(String) : [],
      fixtureIds: Array.isArray(row.fixture_ids) ? row.fixture_ids.map(String) : [],
      bundleFingerprint: String(row.bundle_fingerprint),
      serializerVersion: String(row.serializer_version),
      provenance: row.provenance as Provenance,
      status: row.status as XTraceIngestLineage["status"],
      memoryIds: Array.isArray(row.memory_ids) ? row.memory_ids.map(String) : [],
    };
  }
  return {
    async recordSubmission(input) {
      await request("/xtrace_ingest_jobs?on_conflict=workspace_id,job_id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({
          job_id: input.jobId,
          workspace_id: input.workspaceId,
          deal_id: input.dealId,
          source_revision_ids: input.sourceRevisionIds ?? [],
          source_ids: input.sourceIds,
          fixture_ids: input.fixtureIds,
          bundle_fingerprint: input.bundleFingerprint,
          serializer_version: input.serializerVersion,
          provenance: input.provenance,
          status: input.status,
          memory_ids: [],
        }),
      });
    },
    async recordCompletion(input) {
      const jobs = await request(
        `/xtrace_ingest_jobs?workspace_id=eq.${encodeURIComponent(input.workspaceId)}`
        + `&job_id=eq.${encodeURIComponent(input.jobId)}&limit=1`,
      ) as Record<string, unknown>[];
      const job = jobs[0];
      if (!job) throw new Error(`XTrace ingest job ${input.jobId} has no local lineage`);
      await request(
        `/xtrace_ingest_jobs?workspace_id=eq.${encodeURIComponent(input.workspaceId)}`
        + `&job_id=eq.${encodeURIComponent(input.jobId)}`,
        {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          status: input.status,
          memory_ids: input.memoryIds,
          updated_at: new Date().toISOString(),
        }),
        },
      );
      if (!input.memoryIds.length) return;
      await request("/xtrace_memory_links?on_conflict=workspace_id,memory_id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(input.memoryIds.map((memoryId) => ({
          memory_id: memoryId,
          workspace_id: job.workspace_id,
          deal_id: job.deal_id,
          source_revision_ids: job.source_revision_ids,
          source_ids: job.source_ids,
          fixture_ids: job.fixture_ids,
          provenance: job.provenance,
        }))),
      });
    },
    async listOpenJobs(workspaceId) {
      const rows = await request(
        `/xtrace_ingest_jobs?workspace_id=eq.${encodeURIComponent(workspaceId)}&status=in.(pending,running)&order=created_at.asc`,
      ) as Record<string, unknown>[];
      return rows.map(toIngestLineage);
    },
    async findReusableIngest(input) {
      const rows = await request(
        `/xtrace_ingest_jobs?workspace_id=eq.${encodeURIComponent(input.workspaceId)}&deal_id=eq.${encodeURIComponent(input.dealId)}&bundle_fingerprint=eq.${encodeURIComponent(input.bundleFingerprint)}&serializer_version=eq.${encodeURIComponent(input.serializerVersion)}&status=in.(pending,running,succeeded)&order=created_at.desc`,
      ) as Record<string, unknown>[];
      const row = rows.find((candidate) =>
        sameStringSet(
          Array.isArray(candidate.source_revision_ids)
            ? candidate.source_revision_ids.map(String)
            : [],
          input.sourceRevisionIds ?? [],
        )
        && sameStringSet(
          Array.isArray(candidate.source_ids) ? candidate.source_ids.map(String) : [],
          input.sourceIds,
        )
        && sameStringSet(
          Array.isArray(candidate.fixture_ids) ? candidate.fixture_ids.map(String) : [],
          input.fixtureIds,
        )
        && String(candidate.bundle_fingerprint) === input.bundleFingerprint
        && String(candidate.serializer_version) === input.serializerVersion
      );
      return row ? toIngestLineage(row) : null;
    },
    async resolve(input) {
      const direct = await request(
        `/xtrace_memory_links?memory_id=eq.${encodeURIComponent(input.memoryId)}&workspace_id=eq.${encodeURIComponent(input.workspaceId)}&limit=1`,
      ) as Record<string, unknown>[];
      if (direct[0]) return toLineage(direct[0]);
      const dealId = input.convId?.startsWith("deal:")
        ? input.convId.slice("deal:".length)
        : "";
      if (!dealId) return null;
      const jobs = await request(
        `/xtrace_ingest_jobs?workspace_id=eq.${encodeURIComponent(input.workspaceId)}&deal_id=eq.${encodeURIComponent(dealId)}&order=created_at.desc&limit=1`,
      ) as Record<string, unknown>[];
      const job = jobs[0];
      if (!job) return null;
      const sourceIds = Array.isArray(job.source_ids) ? job.source_ids.map(String) : [];
      const sourceRevisionIds = Array.isArray(job.source_revision_ids)
        ? job.source_revision_ids.map(String)
        : [];
      const fixtureIds = Array.isArray(job.fixture_ids) ? job.fixture_ids.map(String) : [];
      if (!sourceRevisionIds.length && !sourceIds.length && !fixtureIds.length) {
        return null;
      }
      return {
        memoryId: input.memoryId,
        workspaceId: input.workspaceId,
        dealId,
        sourceRevisionIds,
        sourceIds,
        fixtureIds,
        provenance: job.provenance as Provenance,
      };
    },
  };
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const expected = new Set(right);
  return left.every((value) => expected.has(value));
}

function lineageKey(workspaceId: string, externalId: string): string {
  return JSON.stringify([workspaceId, externalId]);
}

let singleton: XTraceLineageRepository | undefined;

export function getXTraceLineageRepository(): XTraceLineageRepository {
  if (singleton) return singleton;
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  singleton = url && serviceRoleKey
    ? createSupabaseXTraceLineageRepository({ url, serviceRoleKey })
    : createMemoryXTraceLineageRepository();
  return singleton;
}
