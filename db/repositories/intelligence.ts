import {
  CompanyAnalysisSchema,
  EvidenceCoverageSchema,
  ReportAnalysisStatusSchema,
  type CompanyAnalysis,
  type CompanyAnalysisCounts,
  type EvidenceCoverage,
  type OpportunityReportItem,
  type ReportAnalysisStatus,
} from "../../lib/contracts/domain";
import {
  IntegrationTransportError,
  isRetryableTransportStatus,
} from "../../lib/api/errors";
import { withinPublicationWindow } from "../../lib/market/dedupe";
import type { NormalizedMarketEvent } from "../../lib/market/types";
import { sanitizeReportOpportunities } from "../../lib/reports/next-step-policy";

const MARKET_EVENT_WINDOW_DAYS = 14;

interface IntelligenceRepositoryClockOptions {
  now?: () => Date;
}

interface IntelligenceReportIdentity {
  id: string;
  workspaceId: string;
  runId: string;
  createdAt: string;
  marketSummary: string;
}

export interface IntelligenceReportWrite extends IntelligenceReportIdentity {
  opportunities: OpportunityReportItem[];
  // Internal write-time snapshot. It validates that every Deal selected by the
  // authoritative registry received an analysis, but is not added to legacy
  // report response shapes.
  eligibleDealCount?: number;
  eligibleSnapshotFingerprint?: string;
  analysisStatus?: ReportAnalysisStatus;
  evidenceCoverage?: EvidenceCoverage;
  counts?: CompanyAnalysisCounts;
  priorityDealId?: string | null;
  companyAnalyses?: CompanyAnalysis[];
}

export interface IntelligenceReportRecord extends IntelligenceReportIdentity {
  opportunities: OpportunityReportItem[];
  analysisStatus: ReportAnalysisStatus;
  evidenceCoverage: EvidenceCoverage;
  counts: CompanyAnalysisCounts;
  priorityDealId: string | null;
  companyAnalyses: CompanyAnalysis[];
}

export interface IntelligenceRepository {
  saveMarketEvents(
    events: NormalizedMarketEvent[],
    workspaceId: string,
  ): Promise<void>;
  listMarketEvents(workspaceId: string): Promise<NormalizedMarketEvent[]>;
  saveReport(report: IntelligenceReportWrite): Promise<IntelligenceReportRecord>;
  getReport(
    workspaceId: string,
    reportId: string,
  ): Promise<IntelligenceReportRecord | null>;
  getReportByRunId(
    workspaceId: string,
    runId: string,
  ): Promise<IntelligenceReportRecord | null>;
  listReports(workspaceId: string): Promise<IntelligenceReportRecord[]>;
  listDealAnalyses(
    workspaceId: string,
    dealId: string,
  ): Promise<CompanyAnalysis[]>;
  // Demo choreography: wipe every scan product (reports, analyses, finished
  // runs, market events) while keeping the corpus, XTrace lineage, and
  // stored judgments. Queued and running scans survive.
  resetScanProducts(workspaceId: string): Promise<void>;
}

function marketWindowAt(to: Date) {
  if (!Number.isFinite(to.getTime())) {
    throw new TypeError("Market event reads require a valid current time.");
  }
  return {
    from: new Date(
      to.getTime() - MARKET_EVENT_WINDOW_DAYS * 24 * 60 * 60 * 1_000,
    ),
    to,
  };
}

function currentMarketWindow(now: () => Date) {
  return marketWindowAt(now());
}

export function buildMarketEventsReadPath(input: {
  workspaceId: string;
  now: Date;
}): string {
  const window = marketWindowAt(input.now);
  return `/market_events?workspace_id=eq.${encodeURIComponent(input.workspaceId)}`
    + `&published_at=gte.${encodeURIComponent(window.from.toISOString())}`
    + `&published_at=lte.${encodeURIComponent(window.to.toISOString())}`
    + "&select=payload&order=published_at.desc";
}

const EMPTY_EVIDENCE_COVERAGE: EvidenceCoverage = {
  acceptedPublicEvents: 0,
  excludedPublicItems: 0,
  truncatedPublicEvents: 0,
  recalledDealCount: 0,
  unavailableDealCount: 0,
};

function countsFromAnalyses(
  analyses: readonly CompanyAnalysis[],
): CompanyAnalysisCounts {
  return {
    companyCount: analyses.length,
    beliefRevised: analyses.filter(
      (analysis) => analysis.outcome === "belief_revised",
    ).length,
    monitor: analyses.filter((analysis) => analysis.outcome === "monitor")
      .length,
    noMaterialChange: analyses.filter(
      (analysis) => analysis.outcome === "no_material_change",
    ).length,
    analysisUnavailable: analyses.filter(
      (analysis) => analysis.outcome === "analysis_unavailable",
    ).length,
  };
}

function projectLegacyOpportunity(input: {
  report: IntelligenceReportWrite;
  opportunity: OpportunityReportItem;
  index: number;
}): CompanyAnalysis | null {
  const { report, opportunity, index } = input;
  const sourceIds = opportunity.sources.map((source) => source.id);
  const candidate = {
    id: `${report.id}:legacy:${opportunity.dealId}`,
    reportId: report.id,
    runId: report.runId,
    dealId: opportunity.dealId,
    companyName: opportunity.dealId,
    dealStatus: "screening",
    outcome: "belief_revised",
    confidence: opportunity.confidence,
    score: opportunity.score,
    verifiedSourceCount: new Set(sourceIds).size,
    investmentMemory: {
      previousMeetingSummary: opportunity.previousContext,
      decisionReason: opportunity.previousContext,
      concerns: [],
      revisitConditions: [],
      lastEvaluatedAt: null,
      memoryIds: [],
      sourceIds,
      fixtureIds: opportunity.demoFixtureIds,
    },
    marketEvidence: {
      relationship: "related",
      explanation: opportunity.whyNow,
      eventIds: [],
      events: [],
      sourceIds,
    },
    implications: opportunity.implications,
    recommendedNextMove: opportunity.nextStep,
    companyBrief: {
      icSnapshot: [{
        label: "Legacy recommendation",
        value: opportunity.whyNow,
        unavailableReason: null,
        sourceIds,
      }],
      traction: [],
      dealTerms: [],
      risks: [],
      decisionHistory: [{
        occurredAt: report.createdAt,
        title: `Legacy recommendation ${index + 1}`,
        summary: opportunity.previousContext,
        sourceIds,
      }],
      sourceLineage: opportunity.sources,
    },
    sources: opportunity.sources,
    createdAt: report.createdAt,
  };
  const parsed = CompanyAnalysisSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

function parseCompanyAnalyses(
  report: IntelligenceReportWrite,
): CompanyAnalysis[] {
  if (report.companyAnalyses !== undefined) {
    if (
      report.eligibleDealCount !== undefined
      && (
        !Number.isInteger(report.eligibleDealCount)
        || report.eligibleDealCount < 0
      )
    ) {
      throw new Error(
        "The eligible Deal snapshot count must be a nonnegative integer.",
      );
    }
    if (
      report.eligibleDealCount !== undefined
      && report.companyAnalyses.length !== report.eligibleDealCount
    ) {
      throw new Error(
        `The eligible Deal snapshot contains ${report.eligibleDealCount} Deals, but the report contains ${report.companyAnalyses.length} analyses.`,
      );
    }
    return report.companyAnalyses.map((analysis) =>
      CompanyAnalysisSchema.parse(analysis)
    );
  }

  const opportunities = sanitizeReportOpportunities(report.opportunities);
  return opportunities.flatMap((opportunity, index) => {
    const analysis = projectLegacyOpportunity({ report, opportunity, index });
    return analysis ? [analysis] : [];
  });
}

function validateEligibleSnapshot(report: IntelligenceReportWrite): {
  count: number;
  fingerprint: string;
} | null {
  if (report.companyAnalyses === undefined) return null;
  if (
    !Number.isInteger(report.eligibleDealCount)
    || (report.eligibleDealCount ?? -1) < 0
  ) {
    throw new Error(
      "A new analysis report requires an eligible Deal snapshot count.",
    );
  }
  const fingerprint = report.eligibleSnapshotFingerprint?.trim();
  if (!fingerprint) {
    throw new Error(
      "A new analysis report requires an eligible snapshot fingerprint.",
    );
  }
  if (report.companyAnalyses.length !== report.eligibleDealCount) {
    throw new Error(
      `The eligible Deal snapshot contains ${report.eligibleDealCount} Deals, but the report contains ${report.companyAnalyses.length} analyses.`,
    );
  }
  if (
    report.counts
    && report.counts.companyCount !== report.eligibleDealCount
  ) {
    throw new Error(
      "The report company count does not match the eligible Deal snapshot.",
    );
  }
  return { count: report.eligibleDealCount, fingerprint };
}

function safeReport(report: IntelligenceReportWrite): IntelligenceReportRecord {
  const cloned = structuredClone(report);
  const legacyShape = { ...cloned };
  delete legacyShape.eligibleDealCount;
  delete legacyShape.eligibleSnapshotFingerprint;
  const workspaceId = requiredWorkspaceId(cloned.workspaceId);
  const opportunities = sanitizeReportOpportunities(cloned.opportunities);
  const companyAnalyses = parseCompanyAnalyses({
    ...cloned,
    opportunities,
  });
  const counts = companyAnalyses.length > 0
    ? countsFromAnalyses(companyAnalyses)
    : cloned.counts ?? countsFromAnalyses([]);
  return {
    ...legacyShape,
    workspaceId,
    opportunities,
    analysisStatus: ReportAnalysisStatusSchema.parse(
      cloned.analysisStatus ?? "completed",
    ),
    evidenceCoverage: EvidenceCoverageSchema.parse(
      cloned.evidenceCoverage ?? EMPTY_EVIDENCE_COVERAGE,
    ),
    counts,
    priorityDealId: cloned.priorityDealId
      ?? companyAnalyses.find(
        (analysis) => analysis.outcome === "belief_revised",
      )?.dealId
      ?? null,
    companyAnalyses,
  };
}

function requiredWorkspaceId(workspaceId: string): string {
  const normalized = workspaceId?.trim();
  if (!normalized) throw new Error("A workspace is required.");
  return normalized;
}

function workspaceIdentity(workspaceId: string, externalId: string): string {
  return JSON.stringify([requiredWorkspaceId(workspaceId), externalId]);
}

export function createMemoryIntelligenceRepository(
  options: IntelligenceRepositoryClockOptions = {},
): IntelligenceRepository {
  const events = new Map<string, { workspaceId: string; event: NormalizedMarketEvent }>();
  const reports = new Map<string, IntelligenceReportRecord>();
  const snapshots = new Map<string, { count: number; fingerprint: string }>();
  const now = options.now ?? (() => new Date());
  return {
    async saveMarketEvents(items, workspaceId) {
      workspaceId = requiredWorkspaceId(workspaceId);
      for (const event of items) {
        events.set(workspaceIdentity(workspaceId, event.id), {
          workspaceId,
          event: structuredClone(event),
        });
      }
    },
    async listMarketEvents(workspaceId) {
      const { to } = currentMarketWindow(now);
      return [...events.values()]
        .filter((row) =>
          row.workspaceId === workspaceId
          && withinPublicationWindow(
            row.event.publishedAt,
            to,
            MARKET_EVENT_WINDOW_DAYS,
          )
        )
        .map((row) => structuredClone(row.event))
        .sort((left, right) => right.publishedAt.localeCompare(left.publishedAt));
    },
    async saveReport(report) {
      const snapshot = validateEligibleSnapshot(report);
      const validated = safeReport(report);
      const key = workspaceIdentity(validated.workspaceId, validated.id);
      const existingSnapshot = snapshots.get(key);
      if (
        existingSnapshot
        && snapshot
        && (
          existingSnapshot.count !== snapshot.count
          || existingSnapshot.fingerprint !== snapshot.fingerprint
        )
      ) {
        throw new Error(
          "The report's eligible Deal snapshot is immutable and cannot be replaced with a different snapshot.",
        );
      }
      reports.set(
        key,
        structuredClone(validated),
      );
      if (snapshot) snapshots.set(key, snapshot);
      return structuredClone(validated);
    },
    async getReport(workspaceId, reportId) {
      const report = reports.get(workspaceIdentity(workspaceId, reportId));
      return report ? structuredClone(report) : null;
    },
    async getReportByRunId(workspaceId, runId) {
      const report = [...reports.values()].find(
        (candidate) =>
          candidate.workspaceId === workspaceId
          && candidate.runId === runId,
      );
      return report ? structuredClone(report) : null;
    },
    async listReports(workspaceId) {
      return [...reports.values()]
        .filter((report) => report.workspaceId === workspaceId)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .map((report) => structuredClone(report));
    },
    async listDealAnalyses(workspaceId, dealId) {
      return [...reports.values()]
        .filter((report) => report.workspaceId === workspaceId)
        .flatMap((report) => report.companyAnalyses)
        .filter((analysis) => analysis.dealId === dealId)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .map((analysis) => structuredClone(analysis));
    },
    async resetScanProducts(workspaceId) {
      workspaceId = requiredWorkspaceId(workspaceId);
      for (const [key, row] of events) {
        if (row.workspaceId === workspaceId) events.delete(key);
      }
      for (const [key, report] of reports) {
        if (report.workspaceId === workspaceId) reports.delete(key);
      }
    },
  };
}

export function createSupabaseIntelligenceRepository(options: {
  url: string;
  serviceRoleKey: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}): IntelligenceRepository {
  const base = `${options.url.replace(/\/$/, "")}/rest/v1`;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());
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
    const body = await response.text();
    return body.trim() ? JSON.parse(body) : null;
  }
  function toAnalysis(row: Record<string, unknown>): CompanyAnalysis {
    const sources = Array.isArray(row.source_refs) ? row.source_refs : [];
    return CompanyAnalysisSchema.parse({
      id: String(row.id),
      reportId: String(row.report_id),
      runId: String(row.run_id),
      dealId: String(row.deal_id),
      companyName: String(row.company_name),
      dealStatus: row.deal_status,
      outcome: row.outcome,
      confidence: row.confidence,
      score: Number(row.score),
      verifiedSourceCount: new Set(
        sources.flatMap((source) =>
          source && typeof source === "object" && "id" in source
            ? [String(source.id)]
            : []
        ),
      ).size,
      investmentMemory: row.investment_memory,
      marketEvidence: row.market_evidence,
      implications: row.implications,
      recommendedNextMove: String(row.recommended_next_move),
      companyBrief: row.company_brief,
      sources,
      createdAt: String(row.created_at),
    });
  }
  function toReport(
    row: Record<string, unknown>,
    analyses: CompanyAnalysis[] = [],
  ): IntelligenceReportRecord {
    return safeReport({
      id: String(row.id),
      workspaceId: String(row.workspace_id),
      runId: String(row.run_id),
      createdAt: String(row.created_at),
      marketSummary: String(row.market_summary),
      opportunities: sanitizeReportOpportunities(row.opportunities),
      analysisStatus: ReportAnalysisStatusSchema.catch("completed").parse(
        row.analysis_status,
      ),
      evidenceCoverage: EvidenceCoverageSchema.catch(
        EMPTY_EVIDENCE_COVERAGE,
      ).parse(row.evidence_coverage),
      counts: {
        companyCount: Number(row.company_count ?? analyses.length),
        beliefRevised: Number(row.belief_revised_count ?? 0),
        monitor: Number(row.monitor_count ?? 0),
        noMaterialChange: Number(row.no_material_change_count ?? 0),
        analysisUnavailable: Number(
          row.analysis_unavailable_count ?? 0,
        ),
      },
      priorityDealId: row.priority_deal_id
        ? String(row.priority_deal_id)
        : null,
      ...(analyses.length > 0 ? { companyAnalyses: analyses } : {}),
    });
  }
  async function analysesForReportIds(
    workspaceId: string,
    reportIds: string[],
  ): Promise<Map<string, CompanyAnalysis[]>> {
    const grouped = new Map<string, CompanyAnalysis[]>();
    if (reportIds.length === 0) return grouped;
    const filter = `(${reportIds.map(encodeURIComponent).join(",")})`;
    const rows = await request(
      `/company_analyses?workspace_id=eq.${encodeURIComponent(workspaceId)}`
      + `&report_id=in.${filter}&order=created_at.asc,company_name.asc`,
    ) as Record<string, unknown>[];
    for (const row of rows) {
      const analysis = toAnalysis(row);
      const current = grouped.get(analysis.reportId) ?? [];
      current.push(analysis);
      grouped.set(analysis.reportId, current);
    }
    return grouped;
  }
  return {
    async saveMarketEvents(items, workspaceId) {
      workspaceId = requiredWorkspaceId(workspaceId);
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
        buildMarketEventsReadPath({ workspaceId, now: now() }),
      ) as Array<{ payload: NormalizedMarketEvent }>;
      return rows.map((row) => row.payload);
    },
    async saveReport(report) {
      const snapshot = validateEligibleSnapshot(report);
      const validated = safeReport(report);
      const analysesToPersist = report.companyAnalyses === undefined
        ? []
        : validated.companyAnalyses;
      const rows = await request("/rpc/save_intelligence_report", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          p_report: {
            id: validated.id,
            workspaceId: validated.workspaceId,
            runId: validated.runId,
            createdAt: validated.createdAt,
            marketSummary: validated.marketSummary,
            opportunities: validated.opportunities,
            analysisStatus: validated.analysisStatus,
            companyCount: validated.counts.companyCount,
            beliefRevisedCount: validated.counts.beliefRevised,
            monitorCount: validated.counts.monitor,
            noMaterialChangeCount: validated.counts.noMaterialChange,
            analysisUnavailableCount:
              validated.counts.analysisUnavailable,
            priorityDealId: validated.priorityDealId,
            evidenceCoverage: validated.evidenceCoverage,
            eligibleSnapshotCount: snapshot?.count ?? null,
            eligibleSnapshotFingerprint: snapshot?.fingerprint ?? null,
          },
          p_analyses: analysesToPersist.map((analysis) => ({
            ...analysis,
            workspaceId: validated.workspaceId,
            sourceRefs: analysis.sources,
          })),
        }),
      }) as Record<string, unknown>[];
      return toReport(rows[0], validated.companyAnalyses);
    },
    async getReport(workspaceId, reportId) {
      const rows = await request(
        `/intelligence_reports?workspace_id=eq.${encodeURIComponent(workspaceId)}`
        + `&id=eq.${encodeURIComponent(reportId)}&limit=1`,
      ) as Record<string, unknown>[];
      if (!rows[0]) return null;
      const analyses = await analysesForReportIds(workspaceId, [reportId]);
      return toReport(rows[0], analyses.get(reportId) ?? []);
    },
    async getReportByRunId(workspaceId, runId) {
      const rows = await request(
        `/intelligence_reports?workspace_id=eq.${encodeURIComponent(workspaceId)}`
        + `&run_id=eq.${encodeURIComponent(runId)}&limit=1`,
      ) as Record<string, unknown>[];
      if (!rows[0]) return null;
      const reportId = String(rows[0].id);
      const analyses = await analysesForReportIds(workspaceId, [reportId]);
      return toReport(rows[0], analyses.get(reportId) ?? []);
    },
    async listReports(workspaceId) {
      const rows = await request(
        `/intelligence_reports?workspace_id=eq.${encodeURIComponent(workspaceId)}&order=created_at.desc`,
      ) as Record<string, unknown>[];
      const reportIds = rows.map((row) => String(row.id));
      const analyses = await analysesForReportIds(workspaceId, reportIds);
      return rows.map((row) => {
        const reportId = String(row.id);
        return toReport(row, analyses.get(reportId) ?? []);
      });
    },
    async listDealAnalyses(workspaceId, dealId) {
      const rows = await request(
        `/company_analyses?workspace_id=eq.${encodeURIComponent(workspaceId)}`
        + `&deal_id=eq.${encodeURIComponent(dealId)}&order=created_at.desc`,
      ) as Record<string, unknown>[];
      return rows.map(toAnalysis);
    },
    async resetScanProducts(workspaceId) {
      workspaceId = requiredWorkspaceId(workspaceId);
      const workspace = encodeURIComponent(workspaceId);
      // Children first; deleting finished runs also cascades their steps.
      // Queued and running scans survive so an in-flight demo scan can still
      // land its report after the wipe.
      const deletions = [
        `/company_analyses?workspace_id=eq.${workspace}`,
        `/intelligence_reports?workspace_id=eq.${workspace}`,
        `/scan_runs?workspace_id=eq.${workspace}&status=in.(completed,partial,failed)`,
        `/market_events?workspace_id=eq.${workspace}`,
      ];
      for (const path of deletions) {
        await request(path, {
          method: "DELETE",
          headers: { Prefer: "return=minimal" },
        });
      }
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
