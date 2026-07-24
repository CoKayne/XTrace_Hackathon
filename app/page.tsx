"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ReportDraftDialog } from "./report-draft-dialog";
import { ScanProgress } from "./scan-progress";
import {
  buildInternalReportDraft,
  type InternalReportDraft,
} from "../lib/reports/draft";
import { decisionReasonLabel } from "../lib/demo/decision-label";
import type { ChatMemoryStatus } from "../lib/chat/service";

type View =
  | "overview"
  | "deals"
  | "import"
  | "market"
  | "reports"
  | "runs"
  | "chat"
  | "settings";

type DealStatus = "screening" | "watchlist" | "evaluating" | "passed" | "invested";

interface DemoFixture {
  id: string;
  label: string;
  provenance: "demo_fixture";
  meetingSummary: string;
  decisionReason: string;
  concerns: string[];
  revisitConditions: string[];
}

interface Deal {
  id: string;
  companyName: string;
  status: DealStatus;
  documentId: string;
  sourceTitle: string;
  sourceUrl: string;
  fixture?: DemoFixture;
}

interface DocumentItem {
  id: string;
  title: string;
  filename: string;
  role: "deal_document" | "market_report" | "reference";
  companyName?: string;
  byteSize: number;
  importable: boolean;
  sourceUrl: string;
}

interface Overview {
  generatedAt: string;
  windowDays: 14;
  stats: {
    deals: number;
    marketReports: number;
    referenceDocuments: number;
    fixtureDeals: number;
  };
  deals: Deal[];
  documents: DocumentItem[];
}

interface Run {
  id: string;
  mode: "xtrace" | "structured";
  status: "queued" | "running" | "partial" | "completed" | "failed";
  currentStage: string | null;
  warningCount: number;
  warnings: string[];
  createdAt: string;
  completedAt: string | null;
}

interface Source {
  id: string;
  title: string;
  url?: string;
  documentId?: string;
  page?: number;
  publisher?: string;
  publishedAt?: string;
  excerpt: string;
  provenance: "source_document" | "public_web" | "demo_fixture" | "model_inference";
}

interface MarketEvent {
  id: string;
  title: string;
  eventType: string;
  sectors: string[];
  themes: string[];
  summary: string;
  positiveImplications: string[];
  negativeImplications: string[];
  publishedAt: string;
  confidence: "low" | "medium" | "high";
  sources: Source[];
}

interface Opportunity {
  rank: number;
  dealId: string;
  confidence: "medium" | "high";
  score: number;
  whyNow: string;
  previousContext: string;
  implications: { positive: string[]; negative: string[] };
  nextStep: string;
  sources: Source[];
  demoFixtureIds: string[];
}

interface Report {
  id: string;
  runId?: string;
  createdAt: string;
  marketSummary: string;
  opportunities: Opportunity[];
  priorityDealId?: string | null;
}

interface Health {
  postgres: boolean;
  worker: boolean;
  xtrace: boolean;
  anthropic: boolean;
  storage: boolean;
  corpusReady: boolean;
  corpusConfirmedCount: number;
  corpusRequiredCount: number;
  marketProviders: number;
}

interface ImportPreviewItem {
  documentId: string;
  title: string;
  classification: "deal_document" | "market_report";
  company?: string;
  deals?: Array<{ dealId: string; companyName: string; page?: number }>;
  requiresDealConfirmation: boolean;
}

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  citations?: Source[];
  memoryStatus?: ChatMemoryStatus;
}

const nav: Array<{ view: View; label: string; icon: string }> = [
  { view: "overview", label: "Overview", icon: "⌂" },
  { view: "deals", label: "Deals", icon: "▤" },
  { view: "import", label: "Sources", icon: "↥" },
  { view: "market", label: "Market", icon: "◉" },
  { view: "reports", label: "Reports", icon: "◇" },
  { view: "runs", label: "Runs", icon: "↻" },
  { view: "chat", label: "Chat", icon: "⌘" },
  { view: "settings", label: "Settings", icon: "⚙" },
];

const statusLabels: Record<DealStatus, string> = {
  screening: "Screening",
  watchlist: "Watchlist",
  evaluating: "Evaluating",
  passed: "Passed",
  invested: "Invested",
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? `Request failed: ${response.status}`);
  return body.data as T;
}

function formatBytes(bytes: number) {
  return bytes < 1_000_000
    ? `${Math.round(bytes / 1_000)} KB`
    : `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function shortDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export default function Home() {
  const [view, setView] = useState<View>("overview");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [events, setEvents] = useState<MarketEvent[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [xtraceEnabled, setXtraceEnabled] = useState(false);
  const xtraceInitialized = useRef(false);
  const [selectedDocuments, setSelectedDocuments] = useState<string[]>([]);
  const [importPreview, setImportPreview] = useState<ImportPreviewItem[] | null>(null);
  const [confirmedDealAssignments, setConfirmedDealAssignments] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [focusedReportId, setFocusedReportId] = useState<string | null>(null);
  const [reportDraft, setReportDraft] = useState<InternalReportDraft | null>(null);
  const [chatQuestion, setChatQuestion] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [activeRun, setActiveRun] = useState<Run | null>(null);
  const [scanProgressOpen, setScanProgressOpen] = useState(false);

  const load = useCallback(async () => {
    const [model, runRows, marketRows, reportRows, healthState] =
      await Promise.allSettled([
        api<Overview>("/api/overview"),
        api<Run[]>("/api/runs"),
        api<MarketEvent[]>("/api/market/events"),
        api<Report[]>("/api/reports"),
        api<Health>("/api/settings/health"),
      ]);
    if (model.status === "fulfilled") setOverview(model.value);
    else setError(model.reason instanceof Error ? model.reason.message : "Unable to load the fixed corpus");
    if (runRows.status === "fulfilled") setRuns(runRows.value);
    if (marketRows.status === "fulfilled") setEvents(marketRows.value);
    if (reportRows.status === "fulfilled") setReports(reportRows.value);
    if (healthState.status === "fulfilled") {
      setHealth(healthState.value);
      if (!xtraceInitialized.current) {
        setXtraceEnabled(healthState.value.xtrace);
        xtraceInitialized.current = true;
      }
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const searchParams = new URLSearchParams(window.location.search);
      const requestedView = searchParams.get("view");
      if (nav.some((item) => item.view === requestedView)) {
        setView(requestedView as View);
      }
      setFocusedReportId(searchParams.get("report"));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (view !== "reports" || !focusedReportId || !reports.length) return;
    const timer = window.setTimeout(() => {
      document.getElementById(`report-${focusedReportId}`)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [focusedReportId, reports, view]);

  useEffect(() => {
    if (!runs.some((run) => run.status === "queued" || run.status === "running")) return;
    const timer = window.setInterval(() => void load(), 2_500);
    return () => window.clearInterval(timer);
  }, [runs, load]);

  useEffect(() => {
    if (!activeRunId) return;
    let cancelled = false;
    let timer: number | undefined;

    const poll = async () => {
      try {
        const run = await api<Run>(`/api/runs/${encodeURIComponent(activeRunId)}`);
        if (cancelled) return;
        setActiveRun(run);
        setRuns((current) => [
          run,
          ...current.filter((item) => item.id !== run.id),
        ]);

        if (run.status === "completed" || run.status === "partial") {
          const reportRows = await api<Report[]>(
            `/api/reports?runId=${encodeURIComponent(run.id)}`,
          );
          if (cancelled) return;
          const report = reportRows[0];
          if (!report) {
            setError("The scan finished, but its durable report could not be loaded.");
            return;
          }
          setReports((current) => [
            report,
            ...current.filter((item) => item.id !== report.id),
          ]);
          setFocusedReportId(report.id);
          setView("reports");
          setScanProgressOpen(false);
          setActiveRunId(null);
          const url = new URL(window.location.href);
          url.searchParams.set("view", "reports");
          url.searchParams.set("report", report.id);
          window.history.replaceState(
            {},
            "",
            `${url.pathname}${url.search}${url.hash}`,
          );
          setNotice(report.priorityDealId
            ? "Scan complete. The highest-priority company analysis is ready."
            : "Scan complete. No investment belief changed at medium or high confidence; the full report is ready.");
          return;
        }

        if (run.status === "failed") {
          setActiveRunId(null);
          setError("The scan could not produce a report. Review the warning details in System activity.");
          return;
        }

        timer = window.setTimeout(poll, 2_000);
      } catch (pollError) {
        if (cancelled) return;
        setError(pollError instanceof Error
          ? pollError.message
          : "Could not read durable scan progress");
        timer = window.setTimeout(poll, 4_000);
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [activeRunId]);

  const filteredDeals = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return overview?.deals ?? [];
    return (overview?.deals ?? []).filter((deal) =>
      [
        deal.companyName,
        deal.status,
        deal.sourceTitle,
        deal.fixture?.meetingSummary,
        deal.fixture?.decisionReason,
        ...(deal.fixture?.concerns ?? []),
        ...(deal.fixture?.revisitConditions ?? []),
      ]
        .join(" ")
        .toLocaleLowerCase()
        .includes(normalized)
    );
  }, [overview, query]);

  const latestRun = runs[0];
  const latestReport = reports[0];
  const scanReady = Boolean(
    health?.postgres &&
    health.worker &&
    health.anthropic &&
    health.corpusReady &&
    (!xtraceEnabled || health.xtrace),
  );

  function navigate(nextView: View) {
    setView(nextView);
    setFocusedReportId(null);
    const url = new URL(window.location.href);
    if (nextView === "overview") url.searchParams.delete("view");
    else url.searchParams.set("view", nextView);
    url.searchParams.delete("report");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }

  async function runScan() {
    if (!scanReady) {
      setError("Confirm the complete 13-source corpus first. The scan also needs PostgreSQL, an active worker, Anthropic, and—when enabled—XTrace.");
      setView("settings");
      return;
    }
    setBusy("scan");
    setError("");
    try {
      const run = await api<Run>("/api/runs", {
        method: "POST",
        body: JSON.stringify({ xtraceEnabled }),
      });
      setRuns((current) => [run, ...current.filter((item) => item.id !== run.id)]);
      setActiveRunId(run.id);
      setActiveRun(run);
      setScanProgressOpen(true);
      setNotice(`14-day scan ${run.status}. Progress is durable while the worker runs.`);
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : "Could not start scan");
    } finally {
      setBusy(null);
    }
  }

  function selectDocuments(documentIds: string[]) {
    setSelectedDocuments(documentIds);
    setImportPreview(null);
    setConfirmedDealAssignments([]);
  }

  async function previewSources() {
    if (!selectedDocuments.length) return;
    setBusy("preview");
    setError("");
    try {
      const preview = await api<ImportPreviewItem[]>("/api/imports/preview", {
        method: "POST",
        body: JSON.stringify({ documentIds: selectedDocuments }),
      });
      setImportPreview(preview);
      setConfirmedDealAssignments([]);
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : "Could not preview source assignments");
    } finally {
      setBusy(null);
    }
  }

  async function confirmSources() {
    if (!selectedDocuments.length || !importPreview) return;
    const dealConfirmations = importPreview.flatMap((item) => {
      if (!item.requiresDealConfirmation) return [];
      const previewDeals = item.deals?.length
        ? item.deals
        : (overview?.deals ?? [])
            .filter((deal) => deal.documentId === item.documentId)
            .map((deal) => ({ dealId: deal.id, companyName: deal.companyName }));
      return previewDeals.map((deal) => ({
        documentId: item.documentId,
        dealId: deal.dealId,
      }));
    });
    if (!dealConfirmations.every(({ documentId, dealId }) =>
      confirmedDealAssignments.includes(`${documentId}:${dealId}`)
    )) {
      setError("Confirm every company and Deal assignment before ingestion.");
      return;
    }
    setBusy("import");
    setError("");
    try {
      const result = await api<{
        memoryBundles: unknown[];
        xtraceConfigured: boolean;
        xtraceJobs: unknown[];
        xtraceErrors: string[];
      }>("/api/imports/confirm", {
        method: "POST",
        body: JSON.stringify({
          workspaceId: "workspace_demo",
          documentIds: selectedDocuments,
          dealConfirmations,
        }),
      });
      setNotice(result.xtraceConfigured
        ? `${selectedDocuments.length} sources confirmed; ${result.xtraceJobs.length} Deal memories submitted to XTrace${result.xtraceErrors.length ? ` with ${result.xtraceErrors.length} warning(s)` : ""}.`
        : `${selectedDocuments.length} sources confirmed. XTrace ingestion was skipped because the integration is not configured; structured mode remains available.`);
      await load();
      setImportPreview(null);
      setConfirmedDealAssignments([]);
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "Could not confirm sources");
    } finally {
      setBusy(null);
    }
  }

  function draftReport(report: Report) {
    if (!overview) return;
    setReportDraft(buildInternalReportDraft({
      report,
      companyNames: Object.fromEntries(
        overview.deals.map((deal) => [deal.id, deal.companyName]),
      ),
      appOrigin: window.location.origin,
    }));
  }

  async function askChat(event: FormEvent) {
    event.preventDefault();
    const question = chatQuestion.trim();
    if (!question) return;
    setChatMessages((current) => [...current, { role: "user", text: question }]);
    setChatQuestion("");
    setBusy("chat");
    setError("");
    try {
      const answer = await api<{
        answer: string;
        citations: Source[];
        memoryStatus: ChatMemoryStatus;
        insufficientEvidence: boolean;
      }>("/api/chat", {
        method: "POST",
        body: JSON.stringify({ question, xtraceEnabled }),
      });
      setChatMessages((current) => [
        ...current,
        {
          role: "assistant",
          text: answer.answer,
          citations: answer.citations,
          memoryStatus: answer.memoryStatus,
        },
      ]);
    } catch (chatError) {
      setError(chatError instanceof Error ? chatError.message : "Chat unavailable");
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="vsee-shell">
      <aside className="vsee-rail">
        <button className="vsee-brand" onClick={() => navigate("overview")} aria-label="VSee overview">
          <span>VS</span>
          <b>VSee</b>
        </button>
        <nav>
          {nav.map((item) => (
            <button
              key={item.view}
              className={view === item.view ? "active" : ""}
              onClick={() => navigate(item.view)}
              title={item.label}
              aria-label={`Open ${item.label}`}
              aria-current={view === item.view ? "page" : undefined}
            >
              <i>{item.icon}</i>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="vsee-rail-status">
          <span className={health?.xtrace ? "healthy" : ""} />
          <small>{health?.xtrace ? "XTRACE READY" : "XTRACE UNAVAILABLE"}</small>
        </div>
      </aside>

      <section className="vsee-main">
        <header className="vsee-topbar">
          <div>
            <span className="vsee-eyebrow">VC DECISION INTELLIGENCE</span>
            <strong>{nav.find((item) => item.view === view)?.label}</strong>
          </div>
          <div className="vsee-top-actions">
            <button
              className={`vsee-memory-toggle ${xtraceEnabled ? "on" : ""}`}
              onClick={() => setXtraceEnabled((enabled) => !enabled)}
              disabled={!health?.xtrace}
              role="switch"
              aria-checked={xtraceEnabled}
              aria-label={health?.xtrace ? "Use XTrace memory for scans and chat" : "XTrace is not configured"}
            >
              <span />
              XTrace {xtraceEnabled ? "ON" : "OFF"}
            </button>
            <button
              className="vsee-run"
              onClick={runScan}
              disabled={busy === "scan" || !scanReady}
              aria-label={scanReady ? "Run a 14-day market scan" : "Scan unavailable until required integrations are ready"}
              title={scanReady ? undefined : "PostgreSQL, worker, Anthropic, and the selected memory mode must be ready"}
            >
              {busy === "scan" ? "QUEUING…" : "WAKE AGENT & SCAN MARKET"} <span>→</span>
            </button>
          </div>
        </header>

        {error && <div className="vsee-banner error" role="alert">{error}<button onClick={() => setError("")} aria-label="Dismiss error">×</button></div>}
        {notice && <div className="vsee-banner" role="status">{notice}<button onClick={() => setNotice("")} aria-label="Dismiss notice">×</button></div>}

        {!overview ? (
          <section className="vsee-loading">Loading the fixed evidence corpus…</section>
        ) : (
          <>
            {view === "overview" && (
              <OverviewView
                overview={overview}
                latestRun={latestRun}
                latestReport={latestReport}
                events={events}
                onNavigate={navigate}
                onRun={runScan}
                scanReady={scanReady}
                xtraceEnabled={xtraceEnabled}
              />
            )}
            {view === "deals" && (
              <DealsView deals={filteredDeals} query={query} onQuery={setQuery} />
            )}
            {view === "import" && (
              <SourcesView
                documents={overview.documents}
                selected={selectedDocuments}
                preview={importPreview}
                confirmedDealAssignments={confirmedDealAssignments}
                deals={overview.deals}
                onSelected={selectDocuments}
                onPreview={previewSources}
                onConfirm={confirmSources}
                onConfirmedDealAssignments={setConfirmedDealAssignments}
                busy={busy === "import" || busy === "preview"}
              />
            )}
            {view === "market" && <MarketView events={events} />}
            {view === "reports" && (
              <ReportsView
                reports={reports}
                deals={overview.deals}
                onDraft={draftReport}
                focusedReportId={focusedReportId}
              />
            )}
            {view === "runs" && <RunsView runs={runs} />}
            {view === "chat" && (
              <ChatView
                messages={chatMessages}
                question={chatQuestion}
                onQuestion={setChatQuestion}
                onSubmit={askChat}
                busy={busy === "chat"}
                xtraceEnabled={xtraceEnabled}
              />
            )}
            {view === "settings" && <SettingsView health={health} />}
          </>
        )}
      </section>
      <ReportDraftDialog
        draft={reportDraft}
        onClose={() => setReportDraft(null)}
      />
      {scanProgressOpen && activeRun && (
        <ScanProgress
          run={activeRun}
          onClose={() => setScanProgressOpen(false)}
        />
      )}
    </main>
  );
}

function OverviewView({
  overview,
  latestRun,
  latestReport,
  events,
  onNavigate,
  onRun,
  scanReady,
  xtraceEnabled,
}: {
  overview: Overview;
  latestRun?: Run;
  latestReport?: Report;
  events: MarketEvent[];
  onNavigate(view: View): void;
  onRun(): void;
  scanReady: boolean;
  xtraceEnabled: boolean;
}) {
  const companyByDeal = new Map(
    overview.deals.map((deal) => [deal.id, deal.companyName]),
  );
  return (
    <div className="vsee-content">
      <section className="vsee-hero">
        <div>
          <p className="vsee-eyebrow">SECOND LOOK ENGINE</p>
          <h1>The market changed.<br /><em>Your old Deal memory should know.</em></h1>
          <p>
            VSee scans the last 14 days of public evidence, recalls historical Deals
            {xtraceEnabled ? " through XTrace" : " from confirmed structured memory"}, and surfaces
            only medium- or high-confidence reasons to look again.
          </p>
        </div>
        <div className="vsee-hero-card">
          <span>FIXED MVP CORPUS</span>
          <strong>{overview.stats.deals}</strong>
          <p>historical Deals</p>
          <div><b>{overview.stats.marketReports}</b> market reports <b>{overview.stats.fixtureDeals}</b> labeled VC decisions</div>
        </div>
      </section>

      <section className="vsee-stat-grid">
        <Metric label="Historical Deals" value={String(overview.stats.deals)} note="From 9 supplied pitch deck files" />
        <Metric label="Market window" value="14 days" note="Manual, repeatable scan" />
        <Metric label="Latest signals" value={String(events.length)} note="Evidence-linked only" />
        <Metric
          label="Latest run"
          value={latestRun?.status.toUpperCase() ?? "NOT RUN"}
          note={latestRun?.currentStage ?? "Ready when you are"}
        />
      </section>

      <section className="vsee-section-grid">
        <article className="vsee-panel vsee-workflow">
          <header>
            <span>LIVE WORKFLOW</span>
            <button onClick={onRun} disabled={!scanReady}>
              {scanReady ? "START SCAN →" : "SCAN NOT READY"}
            </button>
          </header>
          {[
            ["01", "Observe", "Collect and deduplicate public events published in the latest 14 days."],
            ["02", "Recall", xtraceEnabled
              ? "Use XTrace to recover source-backed facts and labeled internal decision context."
              : "Use the confirmed structured Deal context; XTrace is not active for this run."],
            ["03", "Match", "Claude connects changed conditions to the Deals that may be affected."],
            ["04", "Act", "Rank a cited Top 5 and prepare a copy-ready internal brief for the investor."],
          ].map(([number, title, copy]) => (
            <div className="vsee-workflow-row" key={number}>
              <b>{number}</b><strong>{title}</strong><p>{copy}</p>
            </div>
          ))}
        </article>
        <article className="vsee-panel vsee-latest">
          <header><span>LATEST INTELLIGENCE</span><button onClick={() => onNavigate("reports")}>VIEW REPORTS</button></header>
          {latestReport ? (
            <>
              <h2>{latestReport.opportunities.length} Deals deserve another look</h2>
              <p>{latestReport.marketSummary}</p>
              {latestReport.opportunities.slice(0, 3).map((item) => (
                <div className="vsee-mini-result" key={`${latestReport.id}-${item.dealId}`}>
                  <span>#{item.rank}</span>
                  <div><strong>{companyByDeal.get(item.dealId) ?? item.dealId}</strong><small>{item.confidence} confidence · {Math.round(item.score * 100)}%</small></div>
                </div>
              ))}
            </>
          ) : (
            <div className="vsee-empty">
              <span>◇</span>
              <h2>No report yet</h2>
              <p>Run the scan to connect current market evidence with historical Deal context.</p>
            </div>
          )}
        </article>
      </section>
    </div>
  );
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return <article className="vsee-metric"><span>{label}</span><strong>{value}</strong><small>{note}</small></article>;
}

function DealsView({ deals, query, onQuery }: { deals: Deal[]; query: string; onQuery(value: string): void }) {
  return (
    <div className="vsee-content">
      <SectionTitle eyebrow="HISTORICAL MEMORY" title="Every Deal you have already met." copy="Company facts come from the supplied pitch decks. Investment state and prior decision context are synthetic demo fixtures only when explicitly labeled." />
      <input
        className="vsee-search"
        value={query}
        onChange={(event) => onQuery(event.target.value)}
        placeholder="Search company, status, or remembered context…"
        aria-label="Search historical Deals"
      />
      {!deals.length ? (
        <Empty
          title="No Deals match this search"
          copy={query ? `No company, status, or remembered context matches “${query}”.` : "No historical Deals are available."}
        />
      ) : (
        <div className="vsee-deal-list">
          {deals.map((deal) => (
          <article className="vsee-deal" key={deal.id}>
            <div className="vsee-monogram">{deal.companyName.slice(0, 2).toUpperCase()}</div>
            <div className="vsee-deal-name">
              <strong>{deal.companyName}</strong>
              <a href={deal.sourceUrl} target="_blank" rel="noreferrer">{deal.sourceTitle} ↗</a>
            </div>
            <span className={`vsee-status ${deal.status}`}>{statusLabels[deal.status]}</span>
            <div className="vsee-context">
              {deal.fixture ? (
                <>
                  <b>{deal.fixture.label}</b>
                  <dl className="vsee-context-grid">
                    <div>
                      <dt>{decisionReasonLabel(deal.status)}</dt>
                      <dd>{deal.fixture.decisionReason}</dd>
                    </div>
                    <div>
                      <dt>Partner concern</dt>
                      <dd>{deal.fixture.concerns.join(" · ")}</dd>
                    </div>
                    <div>
                      <dt>Revisit condition</dt>
                      <dd>{deal.fixture.revisitConditions.join(" · ")}</dd>
                    </div>
                    <div>
                      <dt>Previous meeting summary</dt>
                      <dd>{deal.fixture.meetingSummary}</dd>
                    </div>
                  </dl>
                </>
              ) : (
                <><b>SOURCE ONLY</b><span>No synthetic decision record attached.</span></>
              )}
            </div>
          </article>
          ))}
        </div>
      )}
    </div>
  );
}

function SourcesView({
  documents,
  selected,
  preview,
  confirmedDealAssignments,
  deals,
  onSelected,
  onPreview,
  onConfirm,
  onConfirmedDealAssignments,
  busy,
}: {
  documents: DocumentItem[];
  selected: string[];
  preview: ImportPreviewItem[] | null;
  confirmedDealAssignments: string[];
  deals: Deal[];
  onSelected(ids: string[]): void;
  onPreview(): void;
  onConfirm(): void;
  onConfirmedDealAssignments(ids: string[]): void;
  busy: boolean;
}) {
  const assignments = (preview ?? []).flatMap((item) => {
    if (!item.requiresDealConfirmation) return [];
    const previewDeals = item.deals?.length
      ? item.deals
      : deals
          .filter((deal) => deal.documentId === item.documentId)
          .map((deal) => ({ dealId: deal.id, companyName: deal.companyName, page: undefined }));
    return previewDeals.map((deal) => ({
      ...deal,
      documentId: item.documentId,
      documentTitle: item.title,
      key: `${item.documentId}:${deal.dealId}`,
    }));
  });
  const assignmentsResolved = (preview ?? [])
    .filter((item) => item.requiresDealConfirmation)
    .every((item) => (item.deals?.length ?? deals.filter((deal) => deal.documentId === item.documentId).length) > 0);
  const ownershipConfirmed = assignmentsResolved && assignments.every((assignment) =>
    confirmedDealAssignments.includes(assignment.key)
  );
  const importableIds = documents.filter((item) => item.importable).map((item) => item.id);
  const completeCorpusSelected = selected.length === importableIds.length &&
    importableIds.every((documentId) => selected.includes(documentId));

  function toggle(documentId: string) {
    onSelected(selected.includes(documentId)
      ? selected.filter((id) => id !== documentId)
      : [...selected, documentId]);
  }
  return (
    <div className="vsee-content">
      <SectionTitle eyebrow="PRELOADED SOURCES" title="Confirm the evidence corpus." copy="The MVP uses exactly the supplied 9 pitch decks and 4 market reports. The VC Brain remains reference-only and never enters runtime memory." />
      <div className="vsee-source-actions">
        <span>{selected.length} selected</span>
        <button onClick={() => onSelected(importableIds)}>SELECT 13 PRODUCT INPUTS</button>
        {!preview && (
          <button className="primary" onClick={onPreview} disabled={!completeCorpusSelected || busy}>
            {busy ? "PREPARING…" : "REVIEW ASSIGNMENTS →"}
          </button>
        )}
      </div>
      {preview && (
        <section className="vsee-import-review" aria-labelledby="import-review-title">
          <header>
            <div>
              <span>STEP 2 OF 2</span>
              <h2 id="import-review-title">Confirm company &amp; Deal ownership</h2>
              <p>Verify every pitch deck assignment before the App creates memory or submits it to XTrace.</p>
            </div>
            <button onClick={() => onSelected([...selected])} disabled={busy}>EDIT SELECTION</button>
          </header>
          <div className="vsee-import-assignments">
            {assignments.map((assignment) => {
              const checked = confirmedDealAssignments.includes(assignment.key);
              return (
                <label key={assignment.key}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onConfirmedDealAssignments(checked
                      ? confirmedDealAssignments.filter((key) => key !== assignment.key)
                      : [...confirmedDealAssignments, assignment.key])}
                    aria-label={`Confirm ${assignment.companyName} belongs to ${assignment.dealId}`}
                  />
                  <strong>{assignment.companyName}</strong>
                  <small>
                    {assignment.documentTitle}{assignment.page ? ` · p.${assignment.page}` : ""} → {assignment.dealId}
                  </small>
                </label>
              );
            })}
            {preview.filter((item) => !item.requiresDealConfirmation).map((item) => (
              <div className="vsee-import-market" key={item.documentId}>
                <span aria-hidden="true">✓</span>
                <strong>{item.title}</strong>
                <small>Market report · no Deal assignment required</small>
              </div>
            ))}
          </div>
          {!assignmentsResolved && (
            <p className="vsee-import-warning" role="alert">
              At least one pitch deck has no Deal assignment. Return to the source data before ingestion.
            </p>
          )}
          <footer>
            <span>{confirmedDealAssignments.length} of {assignments.length} Deal assignments confirmed</span>
            <button className="primary" onClick={onConfirm} disabled={!ownershipConfirmed || busy}>
              {busy ? "INGESTING…" : "CONFIRM & INGEST"}
            </button>
          </footer>
        </section>
      )}
      <div className="vsee-doc-grid">
        {documents.map((document) => (
          <article className={`vsee-doc ${!document.importable ? "reference" : ""}`} key={document.id}>
            <label>
              <input
                type="checkbox"
                checked={selected.includes(document.id)}
                disabled={!document.importable}
                onChange={() => toggle(document.id)}
                aria-label={`${selected.includes(document.id) ? "Deselect" : "Select"} ${document.title}`}
              />
              <span>{document.role.replace("_", " ")}</span>
            </label>
            <strong>{document.title}</strong>
            <small>{formatBytes(document.byteSize)} · PDF</small>
            <a href={document.sourceUrl} target="_blank" rel="noreferrer">OPEN SOURCE ↗</a>
          </article>
        ))}
      </div>
    </div>
  );
}

function MarketView({ events }: { events: MarketEvent[] }) {
  return (
    <div className="vsee-content">
      <SectionTitle eyebrow="PUBLIC EVIDENCE" title="What changed in the last 14 days?" copy="Each event is deduplicated, dated, confidence-rated, and linked to the public evidence that supports it." />
      {!events.length ? <Empty title="No scan results yet" copy="Run the 14-day scan. The app will still write a market summary even if no event meets the opportunity threshold." /> : (
        <div className="vsee-event-list">
          {events.map((event) => (
            <article className="vsee-event" key={event.id}>
              <header><span>{event.eventType}</span><b className={event.confidence}>{event.confidence} confidence</b><time>{shortDate(event.publishedAt)}</time></header>
              <h2>{event.title}</h2>
              <p>{event.summary}</p>
              <div className="vsee-tags">{[...event.sectors, ...event.themes].map((tag) => <span key={tag}>{tag}</span>)}</div>
              <footer>{event.sources.map((source) => <SourceLink source={source} key={source.id} />)}</footer>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function ReportsView({
  reports,
  deals,
  onDraft,
  focusedReportId,
}: {
  reports: Report[];
  deals: Deal[];
  onDraft(report: Report): void;
  focusedReportId: string | null;
}) {
  const companyByDeal = new Map(deals.map((deal) => [deal.id, deal.companyName]));
  return (
    <div className="vsee-content">
      <SectionTitle eyebrow="DECISION BRIEF" title="Cited reasons for a second look." copy="Only medium- and high-confidence matches enter the Top 5. A recommendation is never proof that a company has improved; it is a reason for the investor to follow up." />
      {!reports.length ? <Empty title="No intelligence report yet" copy="Complete a scan to generate the first evidence-linked report." /> : reports.map((report, reportIndex) => (
        <article
          className={`vsee-report ${focusedReportId === report.id ? "focused" : ""}`}
          id={`report-${report.id}`}
          tabIndex={-1}
          key={report.id}
        >
          <header>
            <div><span>REPORT {shortDate(report.createdAt)}</span><p>{report.marketSummary}</p></div>
            {reportIndex === 0 && (
              <button onClick={() => onDraft(report)}>DRAFT THIS REPORT →</button>
            )}
          </header>
          {report.opportunities.length ? report.opportunities.map((item) => (
            <section className="vsee-opportunity" key={`${report.id}-${item.dealId}`}>
              <div className="vsee-rank">#{item.rank}</div>
              <div>
                <h2>{companyByDeal.get(item.dealId) ?? item.dealId}</h2>
                <span className={`vsee-confidence ${item.confidence}`}>{item.confidence} · {Math.round(item.score * 100)}%</span>
                <h3>Why now</h3><p>{item.whyNow}</p>
                <h3>Previous context</h3><p>{item.previousContext}</p>
                {item.implications.positive.length > 0 && (
                  <><h3>Potential positive effects</h3><ul className="vsee-implications">{item.implications.positive.map((effect) => <li key={effect}>{effect}</li>)}</ul></>
                )}
                {item.implications.negative.length > 0 && (
                  <><h3>Potential negative effects</h3><ul className="vsee-implications">{item.implications.negative.map((effect) => <li key={effect}>{effect}</li>)}</ul></>
                )}
                <h3>Suggested next step</h3><p>{item.nextStep}</p>
                <footer>{item.sources.map((source) => <SourceLink source={source} key={source.id} />)}</footer>
              </div>
            </section>
          )) : <Empty title="No medium-confidence matches" copy="The market summary is retained, but the evidence did not justify surfacing a Deal." />}
        </article>
      ))}
    </div>
  );
}

function RunsView({ runs }: { runs: Run[] }) {
  return (
    <div className="vsee-content">
      <SectionTitle eyebrow="BACKGROUND WORKER" title="Every scan has a durable state." copy="Queued and running scans persist in PostgreSQL, so refreshing or closing the browser does not erase progress." />
      {!runs.length ? <Empty title="No runs yet" copy="Use Run 14-day scan to create the first job." /> : (
        <div className="vsee-run-list">
          {runs.map((run) => (
            <article key={run.id}>
              <span className={`vsee-run-state ${run.status}`}>{run.status}</span>
              <div><strong>{run.mode === "xtrace" ? "XTrace memory mode" : "Structured fallback mode"}</strong><small>{run.id}</small></div>
              <div>
                <b>{run.currentStage ?? "Awaiting worker"}</b>
                <small>{shortDate(run.createdAt)} · {run.warningCount} warnings</small>
                {run.warnings.map((warning, index) => (
                  <small className="vsee-run-warning" key={`${run.id}-warning-${index}`}>{warning}</small>
                ))}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

export function ChatView({
  messages,
  question,
  onQuestion,
  onSubmit,
  busy,
  xtraceEnabled,
}: {
  messages: ChatMessage[];
  question: string;
  onQuestion(value: string): void;
  onSubmit(event: FormEvent): void;
  busy: boolean;
  xtraceEnabled: boolean;
}) {
  return (
    <div className="vsee-content vsee-chat-page">
      <SectionTitle eyebrow="READ-ONLY QUERY" title="Ask the evidence already in VSee." copy={`Chat never browses the web and never changes Deal state. XTrace recall is ${xtraceEnabled ? "enabled" : "disabled"} for this query.`} />
      <div className="vsee-chat-log" aria-live="polite" aria-label="Evidence chat messages">
        {!messages.length && <Empty title="Try a grounded question" copy="For example: Which supplied companies relate to AI infrastructure? Why did we mark 7bridges as passed?" />}
        {messages.map((message, index) => (
          <article className={message.role} key={`${message.role}-${index}`}>
            <span>{message.role === "user" ? "YOU" : "VSEE"}</span>
            {message.role === "assistant" && message.memoryStatus === "unavailable" && (
              <strong className="vsee-chat-memory-warning" role="status">
                XTRACE RECALL UNAVAILABLE · LOCAL-ONLY ANSWER WITHHELD
              </strong>
            )}
            <p>{message.text}</p>
            {!!message.citations?.length && <footer>{message.citations.map((source) => <SourceLink source={source} key={source.id} />)}</footer>}
          </article>
        ))}
      </div>
      <form className="vsee-chat-form" onSubmit={onSubmit}>
        <input
          value={question}
          onChange={(event) => onQuestion(event.target.value)}
          placeholder="Ask about existing Deals, documents, events, or reports…"
          aria-label="Ask a question about existing evidence"
        />
        <button disabled={busy || question.trim().length < 2} aria-label="Ask VSee">
          {busy ? "THINKING…" : "ASK →"}
        </button>
      </form>
    </div>
  );
}

function SettingsView({ health }: { health: Health | null }) {
  const services: Array<[keyof Health, string, string]> = [
    ["postgres", "PostgreSQL", "Persistent application data and worker queue"],
    ["worker", "Background worker", "Durable market scan and report processing"],
    ["xtrace", "XTrace Memory", "Long-term Deal and decision-context recall"],
    ["anthropic", "Anthropic", "Evidence-grounded matching and report reasoning"],
    ["storage", "Private source storage", "Private PDFs and ten-minute source access"],
    ["marketProviders", "Market providers", "Latest 14-day public information"],
  ];
  return (
    <div className="vsee-content">
      <SectionTitle eyebrow="SERVER-SIDE INTEGRATIONS" title="Demo readiness." copy="Keys remain on the server. This public single-workspace demo never sends credentials to the browser." />
      <div className="vsee-health">
        {services.map(([key, name, copy]) => (
          <article key={key}>
            <span className={Boolean(health?.[key]) ? "ready" : ""} />
            <div><strong>{name}</strong><small>{copy}</small></div>
            <b>
              {key === "marketProviders" && health
                ? health.marketProviders > 0 ? `${health.marketProviders} READY` : "NOT CONFIGURED"
                : health?.[key] ? "READY" : "NOT CONFIGURED"}
            </b>
          </article>
        ))}
      </div>
    </div>
  );
}

function SectionTitle({ eyebrow, title, copy }: { eyebrow: string; title: string; copy: string }) {
  return <header className="vsee-section-title"><span className="vsee-eyebrow">{eyebrow}</span><h1>{title}</h1><p>{copy}</p></header>;
}

function Empty({ title, copy }: { title: string; copy: string }) {
  return <div className="vsee-empty"><span>◇</span><h2>{title}</h2><p>{copy}</p></div>;
}

function SourceLink({ source }: { source: Source }) {
  const href = source.documentId
    ? `/api/documents/${encodeURIComponent(source.documentId)}/access${source.page ? `#page=${source.page}` : ""}`
    : source.url;
  return href
    ? <a href={href} target="_blank" rel="noreferrer">
        {source.publisher ?? source.title}{source.page ? ` · p.${source.page}` : ""} ↗
      </a>
    : <span>{source.title}</span>;
}
