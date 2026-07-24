import type { RunStatus } from "../lib/contracts/domain";

export type RunMode = "xtrace" | "structured";
export type StageStatus = "queued" | "running" | "skipped" | "completed" | "failed";

export interface RunRecord {
  id: string;
  workspaceId: string;
  mode: RunMode;
  windowDays: 14;
  status: RunStatus;
  currentStage: string | null;
  warningCount: number;
  warnings: string[];
  workerId: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface RunStageRecord {
  id: string;
  runId: string;
  stage: string;
  status: StageStatus;
  warning: string | null;
  startedAt: string;
  completedAt: string | null;
}

export interface CreateRunRow {
  workspaceId: string;
  mode: RunMode;
  windowDays: 14;
}

export interface DataClient {
  findActiveRun(input: CreateRunRow): Promise<RunRecord | null>;
  insertRun(input: CreateRunRow): Promise<RunRecord>;
  claimNextRun(workerId: string): Promise<RunRecord | null>;
  updateRun(runId: string, patch: Partial<RunRecord>): Promise<RunRecord>;
  getRun(runId: string): Promise<RunRecord | null>;
  listRuns(workspaceId: string): Promise<RunRecord[]>;
  insertRunStage(input: Omit<RunStageRecord, "id">): Promise<RunStageRecord>;
}

function nowIso() {
  return new Date().toISOString();
}

function makeRun(input: CreateRunRow): RunRecord {
  return {
    id: crypto.randomUUID(),
    workspaceId: input.workspaceId,
    mode: input.mode,
    windowDays: input.windowDays,
    status: "queued",
    currentStage: null,
    warningCount: 0,
    warnings: [],
    workerId: null,
    createdAt: nowIso(),
    startedAt: null,
    completedAt: null,
  };
}

export function createMemoryDataClient(): DataClient {
  const runs = new Map<string, RunRecord>();
  const stages: RunStageRecord[] = [];

  return {
    async findActiveRun(input) {
      return [...runs.values()].find((run) =>
        run.workspaceId === input.workspaceId
        && run.mode === input.mode
        && run.windowDays === input.windowDays
        && (run.status === "queued" || run.status === "running")
      ) ?? null;
    },
    async insertRun(input) {
      const run = makeRun(input);
      runs.set(run.id, run);
      return structuredClone(run);
    },
    async claimNextRun(workerId) {
      const run = [...runs.values()]
        .filter((candidate) => candidate.status === "queued")
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
      if (!run) return null;
      run.status = "running";
      run.workerId = workerId;
      run.startedAt = nowIso();
      return structuredClone(run);
    },
    async updateRun(runId, patch) {
      const run = runs.get(runId);
      if (!run) throw new Error(`Run ${runId} was not found`);
      const next = { ...run, ...structuredClone(patch) };
      runs.set(runId, next);
      return structuredClone(next);
    },
    async getRun(runId) {
      const run = runs.get(runId);
      return run ? structuredClone(run) : null;
    },
    async listRuns(workspaceId) {
      return [...runs.values()]
        .filter((run) => run.workspaceId === workspaceId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((run) => structuredClone(run));
    },
    async insertRunStage(input) {
      const stage = { ...structuredClone(input), id: crypto.randomUUID() };
      stages.push(stage);
      return structuredClone(stage);
    },
  };
}

interface SupabaseOptions {
  url: string;
  serviceRoleKey: string;
  fetchImpl?: typeof fetch;
}

function toRunRecord(row: Record<string, unknown>): RunRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    mode: row.mode as RunMode,
    windowDays: 14,
    status: row.status as RunStatus,
    currentStage: row.current_stage ? String(row.current_stage) : null,
    warningCount: Number(row.warning_count ?? 0),
    warnings: Array.isArray(row.warnings) ? row.warnings.map(String) : [],
    workerId: row.worker_id ? String(row.worker_id) : null,
    createdAt: String(row.created_at),
    startedAt: row.started_at ? String(row.started_at) : null,
    completedAt: row.completed_at ? String(row.completed_at) : null,
  };
}

export function createSupabaseDataClient(options: SupabaseOptions): DataClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = `${options.url.replace(/\/$/, "")}/rest/v1`;
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
      const body = await response.text();
      throw new Error(`PostgreSQL gateway ${response.status}: ${body.slice(0, 240)}`);
    }
    if (response.status === 204) return null;
    return response.json();
  }

  return {
    async findActiveRun(input) {
      const params = new URLSearchParams({
        workspace_id: `eq.${input.workspaceId}`,
        mode: `eq.${input.mode}`,
        window_days: `eq.${input.windowDays}`,
        status: "in.(queued,running)",
        order: "created_at.asc",
        limit: "1",
      });
      const rows = await request(`/scan_runs?${params}`) as Record<string, unknown>[];
      return rows[0] ? toRunRecord(rows[0]) : null;
    },
    async insertRun(input) {
      const rows = await request("/scan_runs", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          workspace_id: input.workspaceId,
          mode: input.mode,
          window_days: input.windowDays,
        }),
      }) as Record<string, unknown>[];
      return toRunRecord(rows[0]);
    },
    async claimNextRun(workerId) {
      const rows = await request("/rpc/claim_next_scan_run", {
        method: "POST",
        body: JSON.stringify({ worker_name: workerId }),
      }) as Record<string, unknown>[];
      return rows[0] ? toRunRecord(rows[0]) : null;
    },
    async updateRun(runId, patch) {
      const body: Record<string, unknown> = {};
      if (patch.status !== undefined) body.status = patch.status;
      if (patch.currentStage !== undefined) body.current_stage = patch.currentStage;
      if (patch.warningCount !== undefined) body.warning_count = patch.warningCount;
      if (patch.warnings !== undefined) body.warnings = patch.warnings;
      if (patch.workerId !== undefined) body.worker_id = patch.workerId;
      if (patch.startedAt !== undefined) body.started_at = patch.startedAt;
      if (patch.completedAt !== undefined) body.completed_at = patch.completedAt;
      const rows = await request(`/scan_runs?id=eq.${encodeURIComponent(runId)}`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(body),
      }) as Record<string, unknown>[];
      if (!rows[0]) throw new Error(`Run ${runId} was not found`);
      return toRunRecord(rows[0]);
    },
    async getRun(runId) {
      const rows = await request(`/scan_runs?id=eq.${encodeURIComponent(runId)}&limit=1`) as Record<string, unknown>[];
      return rows[0] ? toRunRecord(rows[0]) : null;
    },
    async listRuns(workspaceId) {
      const rows = await request(`/scan_runs?workspace_id=eq.${encodeURIComponent(workspaceId)}&order=created_at.desc`) as Record<string, unknown>[];
      return rows.map(toRunRecord);
    },
    async insertRunStage(input) {
      const rows = await request("/scan_run_steps", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          run_id: input.runId,
          stage: input.stage,
          status: input.status,
          warning: input.warning,
          started_at: input.startedAt,
          completed_at: input.completedAt,
        }),
      }) as Record<string, unknown>[];
      const row = rows[0];
      return {
        id: String(row.id),
        runId: String(row.run_id),
        stage: String(row.stage),
        status: row.status as StageStatus,
        warning: row.warning ? String(row.warning) : null,
        startedAt: String(row.started_at),
        completedAt: row.completed_at ? String(row.completed_at) : null,
      };
    },
  };
}

let singleton: DataClient | undefined;

export function getDataClient(): DataClient {
  if (singleton) return singleton;
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  singleton = url && serviceRoleKey
    ? createSupabaseDataClient({ url, serviceRoleKey })
    : createMemoryDataClient();
  return singleton;
}

