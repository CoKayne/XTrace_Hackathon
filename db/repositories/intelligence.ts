import type { OpportunityReportItem } from "../../lib/contracts/domain";
import type { NormalizedMarketEvent } from "../../lib/market/types";

const DEFAULT_WORKSPACE_ID = "workspace_demo";

export interface ReportDeliveryRecord {
  status: "pending" | "sent" | "failed";
  recipient?: string;
  claimedAt?: string;
  providerMessageId?: string;
  sentAt?: string;
  error?: string;
}

export interface IntelligenceReportRecord {
  id: string;
  workspaceId: string;
  runId: string;
  createdAt: string;
  marketSummary: string;
  opportunities: OpportunityReportItem[];
  delivery?: ReportDeliveryRecord;
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
  claimReportDelivery(
    reportId: string,
    recipient: string,
  ): Promise<IntelligenceReportRecord | null>;
  updateReportDelivery(
    reportId: string,
    delivery: ReportDeliveryRecord,
  ): Promise<IntelligenceReportRecord>;
}

export function createMemoryIntelligenceRepository(options: {
  now?: () => Date;
  deliveryLeaseMs?: number;
} = {}): IntelligenceRepository {
  const events = new Map<string, { workspaceId: string; event: NormalizedMarketEvent }>();
  const reports = new Map<string, IntelligenceReportRecord>();
  const now = options.now ?? (() => new Date());
  const deliveryLeaseMs = options.deliveryLeaseMs ?? 5 * 60_000;
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
    async claimReportDelivery(reportId, recipient) {
      const report = reports.get(reportId);
      if (!report) throw new Error(`Report ${reportId} was not found`);
      if (report.delivery?.status === "sent") {
        return null;
      }
      if (report.delivery?.status === "pending") {
        const claimedAt = Date.parse(report.delivery.claimedAt ?? "");
        if (
          Number.isFinite(claimedAt)
          && now().getTime() - claimedAt <= deliveryLeaseMs
        ) {
          return null;
        }
      }
      const next = {
        ...report,
        delivery: {
          status: "pending" as const,
          recipient,
          claimedAt: now().toISOString(),
        },
      };
      reports.set(reportId, next);
      return structuredClone(next);
    },
    async updateReportDelivery(reportId, delivery) {
      const report = reports.get(reportId);
      if (!report) throw new Error(`Report ${reportId} was not found`);
      const next = { ...report, delivery: structuredClone(delivery) };
      reports.set(reportId, next);
      return structuredClone(next);
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
      delivery: row.delivery as ReportDeliveryRecord | undefined,
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
          delivery: report.delivery ?? null,
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
    async claimReportDelivery(reportId, recipient) {
      const rows = await request("/rpc/claim_report_delivery", {
        method: "POST",
        body: JSON.stringify({
          p_report_id: reportId,
          p_recipient: recipient,
        }),
      }) as Record<string, unknown>[];
      return rows[0] ? toReport(rows[0]) : null;
    },
    async updateReportDelivery(reportId, delivery) {
      const rows = await request(
        `/intelligence_reports?id=eq.${encodeURIComponent(reportId)}`,
        {
          method: "PATCH",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({ delivery }),
        },
      ) as Record<string, unknown>[];
      if (!rows[0]) throw new Error(`Report ${reportId} was not found`);
      return toReport(rows[0]);
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
