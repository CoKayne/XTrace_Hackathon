import type { Provenance } from "../../lib/contracts/domain";

export interface XTraceIngestLineage {
  jobId: string;
  workspaceId: string;
  dealId: string;
  sourceIds: string[];
  fixtureIds: string[];
  provenance: Provenance;
  status: "pending" | "running" | "succeeded" | "failed";
  memoryIds: string[];
}

export interface XTraceMemoryLineage {
  memoryId: string;
  workspaceId: string;
  dealId: string;
  sourceIds: string[];
  fixtureIds: string[];
  provenance: Provenance;
}

export interface XTraceLineageRepository {
  recordSubmission(input: Omit<XTraceIngestLineage, "memoryIds">): Promise<void>;
  recordCompletion(input: {
    jobId: string;
    status: XTraceIngestLineage["status"];
    memoryIds: string[];
  }): Promise<void>;
  listOpenJobs(workspaceId: string): Promise<XTraceIngestLineage[]>;
  findReusableIngest(input: {
    workspaceId: string;
    dealId: string;
    sourceIds: string[];
    fixtureIds: string[];
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
      const existing = jobs.get(input.jobId);
      jobs.set(input.jobId, {
        ...structuredClone(input),
        memoryIds: existing?.memoryIds ?? [],
      });
    },
    async recordCompletion(input) {
      const job = jobs.get(input.jobId);
      if (!job) throw new Error(`XTrace ingest job ${input.jobId} has no local lineage`);
      const next = {
        ...job,
        status: input.status,
        memoryIds: [...new Set(input.memoryIds)],
      };
      jobs.set(input.jobId, next);
      for (const memoryId of next.memoryIds) {
        memories.set(memoryId, {
          memoryId,
          workspaceId: next.workspaceId,
          dealId: next.dealId,
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
        && sameStringSet(candidate.sourceIds, input.sourceIds)
        && sameStringSet(candidate.fixtureIds, input.fixtureIds)
      );
      return job ? structuredClone(job) : null;
    },
    async resolve(input) {
      const direct = memories.get(input.memoryId);
      if (direct?.workspaceId === input.workspaceId) return structuredClone(direct);
      const dealId = input.convId?.startsWith("deal:")
        ? input.convId.slice("deal:".length)
        : "";
      if (!dealId) return null;
      const job = [...jobs.values()].find((candidate) =>
        candidate.workspaceId === input.workspaceId && candidate.dealId === dealId
      );
      if (!job || (!job.sourceIds.length && !job.fixtureIds.length)) return null;
      return {
        memoryId: input.memoryId,
        workspaceId: input.workspaceId,
        dealId,
        sourceIds: structuredClone(job.sourceIds),
        fixtureIds: structuredClone(job.fixtureIds),
        provenance: job.provenance,
      };
    },
  };
}

function createSupabaseXTraceLineageRepository(options: {
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
  function toLineage(row: Record<string, unknown>): XTraceMemoryLineage {
    return {
      memoryId: String(row.memory_id),
      workspaceId: String(row.workspace_id),
      dealId: String(row.deal_id),
      sourceIds: Array.isArray(row.source_ids) ? row.source_ids.map(String) : [],
      fixtureIds: Array.isArray(row.fixture_ids) ? row.fixture_ids.map(String) : [],
      provenance: row.provenance as Provenance,
    };
  }
  return {
    async recordSubmission(input) {
      await request("/xtrace_ingest_jobs?on_conflict=job_id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({
          job_id: input.jobId,
          workspace_id: input.workspaceId,
          deal_id: input.dealId,
          source_ids: input.sourceIds,
          fixture_ids: input.fixtureIds,
          provenance: input.provenance,
          status: input.status,
          memory_ids: [],
        }),
      });
    },
    async recordCompletion(input) {
      const jobs = await request(
        `/xtrace_ingest_jobs?job_id=eq.${encodeURIComponent(input.jobId)}&limit=1`,
      ) as Record<string, unknown>[];
      const job = jobs[0];
      if (!job) throw new Error(`XTrace ingest job ${input.jobId} has no local lineage`);
      await request(`/xtrace_ingest_jobs?job_id=eq.${encodeURIComponent(input.jobId)}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          status: input.status,
          memory_ids: input.memoryIds,
          updated_at: new Date().toISOString(),
        }),
      });
      if (!input.memoryIds.length) return;
      await request("/xtrace_memory_links?on_conflict=memory_id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(input.memoryIds.map((memoryId) => ({
          memory_id: memoryId,
          workspace_id: job.workspace_id,
          deal_id: job.deal_id,
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
      return rows.map((row) => ({
        jobId: String(row.job_id),
        workspaceId: String(row.workspace_id),
        dealId: String(row.deal_id),
        sourceIds: Array.isArray(row.source_ids) ? row.source_ids.map(String) : [],
        fixtureIds: Array.isArray(row.fixture_ids) ? row.fixture_ids.map(String) : [],
        provenance: row.provenance as Provenance,
        status: row.status as XTraceIngestLineage["status"],
        memoryIds: Array.isArray(row.memory_ids) ? row.memory_ids.map(String) : [],
      }));
    },
    async findReusableIngest(input) {
      const rows = await request(
        `/xtrace_ingest_jobs?workspace_id=eq.${encodeURIComponent(input.workspaceId)}&deal_id=eq.${encodeURIComponent(input.dealId)}&status=in.(pending,running,succeeded)&order=created_at.desc`,
      ) as Record<string, unknown>[];
      const row = rows.find((candidate) =>
        sameStringSet(
          Array.isArray(candidate.source_ids) ? candidate.source_ids.map(String) : [],
          input.sourceIds,
        )
        && sameStringSet(
          Array.isArray(candidate.fixture_ids) ? candidate.fixture_ids.map(String) : [],
          input.fixtureIds,
        )
      );
      return row ? {
        jobId: String(row.job_id),
        workspaceId: String(row.workspace_id),
        dealId: String(row.deal_id),
        sourceIds: Array.isArray(row.source_ids) ? row.source_ids.map(String) : [],
        fixtureIds: Array.isArray(row.fixture_ids) ? row.fixture_ids.map(String) : [],
        provenance: row.provenance as Provenance,
        status: row.status as XTraceIngestLineage["status"],
        memoryIds: Array.isArray(row.memory_ids) ? row.memory_ids.map(String) : [],
      } : null;
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
      const fixtureIds = Array.isArray(job.fixture_ids) ? job.fixture_ids.map(String) : [];
      if (!sourceIds.length && !fixtureIds.length) return null;
      return {
        memoryId: input.memoryId,
        workspaceId: input.workspaceId,
        dealId,
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
