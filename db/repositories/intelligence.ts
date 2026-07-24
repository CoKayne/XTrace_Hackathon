import type { OpportunityReportItem } from "../../lib/contracts/domain";
import type { NormalizedMarketEvent } from "../../lib/market/types";

const DEFAULT_WORKSPACE_ID = "workspace_demo";

export interface IntelligenceReportRecord {
  id: string;
  workspaceId: string;
  runId: string;
  createdAt: string;
  marketSummary: string;
  opportunities: OpportunityReportItem[];
}

export interface IntelligenceRepository {
  saveMarketEvents(
    events: NormalizedMarketEvent[],
    workspaceId?: string,
  ): Promise<void>;
  listMarketEvents(workspaceId: string): Promise<NormalizedMarketEvent[]>;
  saveReport(report: IntelligenceReportRecord): Promise<IntelligenceReportRecord>;
  getReport(reportId: string): Promise<IntelligenceReportRecord | null>;
  listReports(workspaceId: string): Promise<IntelligenceReportRecord[]>;
}

export function createMemoryIntelligenceRepository(): IntelligenceRepository {
  const events = new Map<string, { workspaceId: string; event: NormalizedMarketEvent }>();
  const reports = new Map<string, IntelligenceReportRecord>();
  return {
    async saveMarketEvents(items, workspaceId = DEFAULT_WORKSPACE_ID) {
      for (const event of items) {
        events.set(`${workspaceId}:${event.id}`, {
          workspaceId,
          event: structuredClone(event),
        });
      }
    },
    async listMarketEvents(workspaceId) {
      return [...events.values()]
        .filter((row) => row.workspaceId === workspaceId)
        .map((row) => structuredClone(row.event))
        .sort((left, right) => right.publishedAt.localeCompare(left.publishedAt));
    },
    async saveReport(report) {
      reports.set(report.id, structuredClone(report));
      return structuredClone(report);
    },
    async getReport(reportId) {
      const report = reports.get(reportId);
      return report ? structuredClone(report) : null;
    },
    async listReports(workspaceId) {
      return [...reports.values()]
        .filter((report) => report.workspaceId === workspaceId)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .map((report) => structuredClone(report));
    },
  };
}

function createSupabaseIntelligenceRepository(options: {
  url: string;
  serviceRoleKey: string;
  fetchImpl?: typeof fetch;
}): IntelligenceRepository {
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
    return response.json();
  }
  function toReport(row: Record<string, unknown>): IntelligenceReportRecord {
    return {
      id: String(row.id),
      workspaceId: String(row.workspace_id),
      runId: String(row.run_id),
      createdAt: String(row.created_at),
      marketSummary: String(row.market_summary),
      opportunities: (row.opportunities ?? []) as OpportunityReportItem[],
    };
  }
  return {
    async saveMarketEvents(items, workspaceId = DEFAULT_WORKSPACE_ID) {
      if (!items.length) return;
      await request("/market_events?on_conflict=workspace_id,id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(items.map((event) => ({
          workspace_id: workspaceId,
          id: event.id,
          published_at: event.publishedAt,
          payload: event,
        }))),
      });
    },
    async listMarketEvents(workspaceId) {
      const rows = await request(
        `/market_events?workspace_id=eq.${encodeURIComponent(workspaceId)}&select=payload&order=published_at.desc`,
      ) as Array<{ payload: NormalizedMarketEvent }>;
      return rows.map((row) => row.payload);
    },
    async saveReport(report) {
      const rows = await request("/intelligence_reports?on_conflict=id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify({
          id: report.id,
          workspace_id: report.workspaceId,
          run_id: report.runId,
          created_at: report.createdAt,
          market_summary: report.marketSummary,
          opportunities: report.opportunities,
        }),
      }) as Record<string, unknown>[];
      return toReport(rows[0]);
    },
    async getReport(reportId) {
      const rows = await request(
        `/intelligence_reports?id=eq.${encodeURIComponent(reportId)}&limit=1`,
      ) as Record<string, unknown>[];
      return rows[0] ? toReport(rows[0]) : null;
    },
    async listReports(workspaceId) {
      const rows = await request(
        `/intelligence_reports?workspace_id=eq.${encodeURIComponent(workspaceId)}&order=created_at.desc`,
      ) as Record<string, unknown>[];
      return rows.map(toReport);
    },
  };
}

let singleton: IntelligenceRepository | undefined;

export function getIntelligenceRepository(): IntelligenceRepository {
  if (singleton) return singleton;
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  singleton = url && serviceRoleKey
    ? createSupabaseIntelligenceRepository({ url, serviceRoleKey })
    : createMemoryIntelligenceRepository();
  return singleton;
}
