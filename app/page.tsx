"use client";

import { useEffect, useRef, useState } from "react";

type ScanState = "idle" | "scanning" | "matched";
type Panel = "evidence" | "search" | "help" | "notifications" | "sources" | "activity" | "newDeal" | null;
type DetailTab = "overview" | "traction" | "deal" | "risks" | "history";
type AppView = "overview" | "pipeline" | "signals";

const outreachSubject = "Re-open Asteria Bio · FDA condition changed";
const outreachBody = "Team — the FDA uncertainty behind our November pass has materially changed. XTrace matched the new accelerated-review pilot to our documented revisit condition. I recommend a 30-minute re-evaluation this week to review traction, remaining clinical risk, and round dynamics.";
const decisionDocuments = [
  {
    code: "IC",
    title: "Investment committee memo",
    meta: "Nov 18, 2025 · 6 cited excerpts",
    lineage: "Pages 6–7 · Owner KM · Final IC version",
    excerpt: "The team remains positive on the product and founder quality. The regulatory pathway for AI-assisted diagnostics is not sufficiently clear to underwrite this round.",
  },
  {
    code: "PM",
    title: "Partner meeting notes",
    meta: "Nov 12, 2025 · 4 cited excerpts",
    lineage: "Partner meeting · Owner JL · CRM-synced",
    excerpt: "Strong founder-market fit and early clinical demand. Pricing can be revisited; the FDA path remains the gating issue.",
  },
  {
    code: "FD",
    title: "Founder deck · v4",
    meta: "Oct 29, 2025 · 3 cited pages",
    lineage: "Pages 18–21 · Uploaded by KM · Verified",
    excerpt: "Retrospective validation covers two health systems. A prospective multi-site study is planned, but the accelerated-review route is not yet confirmed.",
  },
  {
    code: "CRM",
    title: "CRM decision log",
    meta: "Oct–Nov 2025 · 1 decision record",
    lineage: "Decision entry · Owner KM · Confirmed Nov 18",
    excerpt: "PASS. Re-open when accelerated review expands to AI-assisted diagnostics.",
  },
];

const dealDirectory = [
  { name: "Asteria Bio", meta: "AI diagnostics · Series A", status: "Passed · revisit", tone: "signal", memories: 14, tags: ["healthcare", "diagnostics", "ai", "regulatory"] },
  { name: "Northstar Robotics", meta: "Automotive automation · Seed", status: "Watching", tone: "neutral", memories: 31, tags: ["automotive", "manufacturing", "robotics", "chassis"] },
  { name: "Arcspan Energy", meta: "Grid & battery software · Series B", status: "Evaluating", tone: "neutral", memories: 18, tags: ["energy", "battery", "electric vehicle", "ev", "automotive"] },
  { name: "Harbor AI", meta: "Security infrastructure · Seed", status: "Passed", tone: "neutral", memories: 22, tags: ["security", "infrastructure", "ai"] },
  { name: "Cinder Systems", meta: "Developer tools · Series A", status: "Invested", tone: "invested", memories: 47, tags: ["developer tools", "software", "infrastructure"] },
  { name: "Torque Materials", meta: "EV battery materials · Series A", status: "Interested", tone: "interested", memories: 19, tags: ["automotive", "electric vehicle", "ev", "battery", "materials"] },
  { name: "VectorForge", meta: "Lightweight vehicle chassis · Seed", status: "Interested", tone: "interested", memories: 11, tags: ["automotive", "chassis", "manufacturing", "materials"] },
  { name: "CombustionX", meta: "Next-gen powertrain · Series B", status: "Passed", tone: "neutral", memories: 26, tags: ["automotive", "engine", "powertrain", "mobility"] },
];

const detailTabs: Array<{ id: DetailTab; label: string; count?: string }> = [
  { id: "overview", label: "IC snapshot" },
  { id: "traction", label: "Traction" },
  { id: "deal", label: "Deal terms" },
  { id: "risks", label: "Risks", count: "3" },
  { id: "history", label: "Decision history" },
];

const marketSignals = [
  { title: "FDA pilots accelerated review for AI-enabled diagnostics", category: "Regulatory", scope: "Watchlist", deals: "1 deal", confidence: "High", sources: "Federal Register + FDA", time: "2h ago", tone: "signal" },
  { title: "Enterprise inference prices fall across major cloud providers", category: "Technology", scope: "Global", deals: "3 deals", confidence: "High", sources: "AWS · Google · Azure", time: "6h ago", tone: "neutral" },
  { title: "Hospital IT budgets shift toward clinical automation", category: "Demand", scope: "Watchlist", deals: "2 deals", confidence: "Medium", sources: "HIMSS survey", time: "1d ago", tone: "neutral" },
  { title: "Series A median valuations hold flat in vertical AI", category: "Funding", scope: "Global", deals: "4 deals", confidence: "Medium", sources: "PitchBook + SEC", time: "2d ago", tone: "neutral" },
];

const workspaceDeals = [
  { name: "Asteria Bio", sector: "AI diagnostics", round: "Series A", workflow: "Revisit", status: "Passed", owner: "KM", last: "8 mo", next: "Partner review", amount: "$3.0M", memories: "14", coverage: 96, alert: "1 new" },
  { name: "Torque Materials", sector: "EV battery materials", round: "Series A", workflow: "Diligence", status: "Interested", owner: "KM", last: "12d", next: "Validate supply plan", amount: "$4.0M", memories: "19", coverage: 94, alert: "—" },
  { name: "Northstar Robotics", sector: "Industrial automation", round: "Seed", workflow: "Diligence", status: "Watching", owner: "JL", last: "42d", next: "Technical deep dive", amount: "$4.5M", memories: "31", coverage: 100, alert: "—" },
  { name: "VectorForge", sector: "Vehicle chassis", round: "Seed", workflow: "First meeting", status: "Interested", owner: "AP", last: "18d", next: "Materials validation", amount: "$2.5M", memories: "11", coverage: 91, alert: "—" },
  { name: "Arcspan Energy", sector: "Grid software", round: "Series B", workflow: "IC", status: "Evaluating", owner: "KM", last: "5d", next: "Partner references", amount: "$8.0M", memories: "18", coverage: 92, alert: "—" },
  { name: "Harbor AI", sector: "Security infrastructure", round: "Seed", workflow: "Archived", status: "Passed", owner: "AP", last: "4 mo", next: "Revisit on traction", amount: "$2.0M", memories: "22", coverage: 88, alert: "—" },
  { name: "Cinder Systems", sector: "Developer tools", round: "Series A", workflow: "Closing", status: "Invested", owner: "JL", last: "8d", next: "Portfolio onboarding", amount: "$5.0M", memories: "47", coverage: 100, alert: "—" },
  { name: "CombustionX", sector: "Next-gen powertrain", round: "Series B", workflow: "Archived", status: "Passed", owner: "AP", last: "3 mo", next: "Monitor policy", amount: "$6.0M", memories: "26", coverage: 97, alert: "—" },
];

function matchesDealSearch(deal: (typeof dealDirectory)[number], rawQuery: string) {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return true;
  const directText = `${deal.name} ${deal.meta} ${deal.status} ${deal.tags.join(" ")}`.toLowerCase();
  if (directText.includes(query)) return true;

  const semanticGroups = [
    { aliases: ["automotive", "car", "cars", "vehicle", "vehicles", "mobility"], concepts: ["automotive", "engine", "chassis", "battery", "ev", "electric vehicle", "mobility", "powertrain"] },
    { aliases: ["healthcare", "health", "biotech"], concepts: ["healthcare", "diagnostics", "clinical", "hospital", "biotech"] },
    { aliases: ["enterprise software", "software", "saas"], concepts: ["software", "developer tools", "infrastructure", "security", "ai"] },
  ];
  const group = semanticGroups.find(({ aliases }) => aliases.some((alias) => query.includes(alias) || alias.includes(query)));
  return group ? group.concepts.some((concept) => directText.includes(concept)) : directText.split(/\s+/).some((term) => term.startsWith(query));
}

export default function Home() {
  const [view, setView] = useState<AppView>("overview");
  const [scanState, setScanState] = useState<ScanState>("idle");
  const [scanStep, setScanStep] = useState(0);
  const [panel, setPanel] = useState<Panel>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>("overview");
  const [searchQuery, setSearchQuery] = useState("");
  const [tasks, setTasks] = useState([false, false, false]);
  const [reviewed, setReviewed] = useState(true);
  const [signalFilter, setSignalFilter] = useState("All");
  const [dealFilter, setDealFilter] = useState("All");
  const [selectedCompanies, setSelectedCompanies] = useState<string[]>([]);
  const [analysisCompanies, setAnalysisCompanies] = useState<string[]>(dealDirectory.map((deal) => deal.name));
  const [analysisMode, setAnalysisMode] = useState<"global" | "selected">("global");
  const [inAgenda, setInAgenda] = useState(false);
  const [xtraceEnabled, setXtraceEnabled] = useState(true);
  const [scanUsesXTrace, setScanUsesXTrace] = useState(true);
  const [outreachCopied, setOutreachCopied] = useState(false);
  const [drawerContext, setDrawerContext] = useState("");
  const [batchReview, setBatchReview] = useState<"idle" | "running" | "complete">("idle");
  const [batchCompanies, setBatchCompanies] = useState(0);
  const [toast, setToast] = useState("");
  const timers = useRef<number[]>([]);
  const searchResults = dealDirectory.filter((deal) => matchesDealSearch(deal, searchQuery));
  const filteredWorkspaceDeals = workspaceDeals.filter((deal) => dealFilter === "All" || deal.status === dealFilter);
  const filteredMemoryCount = filteredWorkspaceDeals.reduce((sum, deal) => sum + Number(deal.memories), 0);
  const analysisMemoryCount = analysisMode === "global" ? 188 : dealDirectory.filter((deal) => analysisCompanies.includes(deal.name)).reduce((sum, deal) => sum + deal.memories, 0);
  const analysisSteps = scanUsesXTrace ? [
    { title: "Agent initiated.", detail: "Monitoring verified sources and fund memory." },
    { title: "Scanning last 24h market signals…", detail: "Found: FDA pilots accelerated review for AI-enabled diagnostics." },
    { title: "Querying XTrace memory for impacted deals…", detail: `${analysisMemoryCount} source-linked memories across ${analysisCompanies.length} ${analysisCompanies.length === 1 ? "company" : "companies"}.` },
    { title: "Conflict detected: Asteria Bio", detail: "Passed because ‘FDA pathway unclear’ — the documented revisit condition now changed." },
    { title: "Synthesizing belief revision…", detail: "Preparing evidence chain and recommended next move." },
  ] : [
    { title: "Agent initiated.", detail: "Monitoring verified public sources." },
    { title: "Scanning last 24h market signals…", detail: "Found: FDA pilots accelerated review for AI-enabled diagnostics." },
    { title: "XTrace memory query skipped.", detail: "Decision memory is turned off for this scan." },
    { title: "Market signal stored.", detail: "No historical deal decision was compared." },
    { title: "Scan complete.", detail: "Turn on XTrace to identify impacted companies and revised beliefs." },
  ];

  const clearTimers = () => {
    timers.current.forEach((timer) => window.clearTimeout(timer));
    timers.current = [];
  };

  useEffect(() => clearTimers, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPanel(null);
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPanel("search");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function runScan(companies?: string[], forceXTrace?: boolean) {
    if (scanState === "scanning") return;
    clearTimers();
    const usingXTrace = forceXTrace ?? xtraceEnabled;
    const targets = companies?.length ? companies : dealDirectory.map((deal) => deal.name);
    setScanUsesXTrace(usingXTrace);
    setAnalysisCompanies(targets);
    setAnalysisMode(companies?.length ? "selected" : "global");
    if (companies?.length) {
      setBatchCompanies(companies.length);
      setBatchReview("running");
    } else {
      setBatchReview("idle");
    }
    setPanel(null);
    setToast("");
    setScanStep(0);
    setScanState("scanning");

    [650, 1350, 2150, 2950].forEach((delay, index) => {
      timers.current.push(window.setTimeout(() => setScanStep(index + 1), delay));
    });
    timers.current.push(window.setTimeout(() => {
      setScanStep(5);
      setScanState("matched");
      setReviewed(!usingXTrace);
      if (companies?.length && usingXTrace) setBatchReview("complete");
    }, 3900));
  }

  function replay() {
    clearTimers();
    setPanel(null);
    setToast("");
    setScanStep(0);
    setScanState("idle");
    setReviewed(true);
    setAnalysisMode("global");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function notify(message: string) {
    setToast(message);
    timers.current.push(window.setTimeout(() => setToast(""), 3200));
  }

  async function copyOutreachEmail() {
    try {
      await navigator.clipboard.writeText(`Subject: ${outreachSubject}\n\n${outreachBody}`);
      setOutreachCopied(true);
      setReviewed(true);
      notify("EMAIL TEMPLATE COPIED");
    } catch {
      notify("COPY FAILED · SELECT THE EMAIL TEXT MANUALLY");
    }
  }

  function openOutreachEmail() {
    window.location.href = `mailto:?subject=${encodeURIComponent(outreachSubject)}&body=${encodeURIComponent(outreachBody)}`;
    setReviewed(true);
    notify("EMAIL DRAFT OPENED");
  }

  function focusOutreach() {
    setPanel(null);
    window.setTimeout(() => document.querySelector(".outreach-panel")?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
  }

  function startBatchReassessment() {
    if (!selectedCompanies.length || !xtraceEnabled) {
      if (!xtraceEnabled) notify("TURN ON XTRACE TO RE-EVALUATE DEAL MEMORY");
      return;
    }
    setView("overview");
    runScan(selectedCompanies);
  }

  function toggleXTrace() {
    if (scanState === "scanning") return;
    const next = !xtraceEnabled;
    clearTimers();
    setXtraceEnabled(next);
    setScanUsesXTrace(next);
    setScanState("idle");
    setScanStep(0);
    setBatchReview("idle");
    setView("overview");
    notify(next ? "XTRACE ON · DECISION MEMORY CONNECTED" : "XTRACE OFF · MARKET-ONLY MODE");
  }

  function toggleSelectedCompany(name: string) {
    setSelectedCompanies((current) => current.includes(name) ? current.filter((company) => company !== name) : [...current, name]);
  }

  function openActivity(context: string) {
    setDrawerContext(context);
    setPanel("activity");
  }

  function exportMemoryCoverage() {
    const rows = ["Company,Status,Owner,Memories,Coverage", ...workspaceDeals.map((deal) => `${deal.name},${deal.status},${deal.owner},${deal.memories},${deal.coverage}%`)];
    const url = URL.createObjectURL(new Blob([rows.join("\n")], { type: "text/csv" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "vsee-memory-coverage.csv";
    anchor.click();
    URL.revokeObjectURL(url);
    notify("MEMORY COVERAGE CSV DOWNLOADED");
  }

  function exportActivityLog() {
    const content = "VSee activity log\n14:34 — Evidence refreshed\n11:20 — Partner note added\nJul 21 — Company record verified\n";
    const url = URL.createObjectURL(new Blob([content], { type: "text/plain" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "vsee-activity-log.txt";
    anchor.click();
    URL.revokeObjectURL(url);
    notify("ACTIVITY LOG DOWNLOADED");
  }

  function scrollToDetails(tab: DetailTab = "overview") {
    setDetailTab(tab);
    window.setTimeout(() => document.getElementById("deal-intelligence")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }

  function navigateProduct(destination: AppView) {
    setView(destination);
    setPanel(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openAsteria() {
    clearTimers();
    setScanStep(5);
    setScanState("matched");
    setXtraceEnabled(true);
    setScanUsesXTrace(true);
    setReviewed(false);
    setAnalysisMode("global");
    setAnalysisCompanies(dealDirectory.map((deal) => deal.name));
    setBatchReview("idle");
    setView("overview");
    setPanel(null);
    window.setTimeout(() => document.querySelector(".match-card")?.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
  }

  return (
    <div className="app-shell">
      <aside className="rail" aria-label="Primary navigation">
        <button className="brand-lockup" aria-label="VSee overview" onClick={() => navigateProduct("overview")}>
          <span className="brand-mark"><i><b>VS</b></i></span>
          <span className="brand-copy"><strong>VSee</strong><small>Decision intelligence</small></span>
        </button>
        <p className="nav-section-label">DEALS</p>
        <nav className="rail-nav" aria-label="Product areas">
          <button className={`rail-item ${view === "overview" ? "active" : ""}`} onClick={() => navigateProduct("overview")}><span>⌂</span><b>Overview</b>{!reviewed && <em>1</em>}</button>
          <button className={`rail-item ${view === "pipeline" ? "active" : ""}`} onClick={() => navigateProduct("pipeline")}><span>▤</span><b>Deals</b><small>8</small></button>
        </nav>
        <p className="nav-section-label intelligence-label">INTELLIGENCE</p>
        <nav className="rail-nav" aria-label="Intelligence areas">
          <button className={`rail-item ${view === "signals" ? "active" : ""}`} onClick={() => navigateProduct("signals")}><span>◉</span><b>Market signals</b></button>
        </nav>
        <div className="rail-footer">
          <button className="source-health" onClick={() => navigateProduct("signals")}>
            <span className="system-dot" />
            <span><strong>Sources healthy</strong><small>3 of 4 connected</small></span>
          </button>
          <div className="workspace-user"><span className="avatar">KM</span><span><strong>Kayne M.</strong><small>Partner · Fund II</small></span></div>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div className="top-actions">
            <button className="memory-search" onClick={() => setPanel("search")} aria-label="Search deal memory">
              <span>⌕</span> Search VSee
            </button>
            <button className={`xtrace-toggle ${xtraceEnabled ? "on" : "off"}`} role="switch" aria-checked={xtraceEnabled} aria-label={`Turn XTrace ${xtraceEnabled ? "off" : "on"}`} onClick={toggleXTrace} disabled={scanState === "scanning"}>
              <span><small>XTRACE</small><strong>{xtraceEnabled ? "ON" : "OFF"}</strong></span><i><b /></i>
            </button>
            <button className="utility-button" onClick={() => setPanel("help")} aria-label="Help">?</button>
            <button className="utility-button notification-button" onClick={() => setPanel("notifications")} aria-label="Notifications">○{!reviewed && <i />}</button>
            <button className={`scan-button ${scanState === "scanning" ? "scanning" : ""}`} onClick={() => { setView("overview"); runScan(); }} disabled={scanState === "scanning"}>
              <span className="button-dot" />
              {scanState === "scanning" ? "Agent running…" : "Wake Agent & Scan Market"}
            </button>
          </div>
        </header>

        <main className="product-main">
          {view === "overview" && <>
          <section className={`signal-zone ${scanState}`} aria-live="polite">
            <div className="signal-meta">
              {scanState === "matched" ? (
                <button className="signal-kicker signal-dismiss" onClick={replay} aria-label="Close analysis result and return to Overview">
                  <i />
                  {scanUsesXTrace ? "BELIEF REVISED" : "MARKET SIGNAL FOUND"}
                  <b>CLOSE ×</b>
                </button>
              ) : (
                <span className="signal-kicker">
                  <i />
                  {scanState === "scanning" ? "AGENT RUNNING" : "XTRACE AGENT READY"}
                </span>
              )}
              <span>JUL 23, 2026</span>
            </div>

            {scanState !== "matched" ? (
              <div className={`scan-stage ${scanState}`}>
                <div className="thinking-shell">
                  <div className="thinking-header">
                    <div className="thinking-identity"><span className="thinking-mark">VS</span><div><strong>VSee Intelligence</strong><small>Evidence-grounded decision analysis</small></div></div>
                    <span className={`thinking-state ${scanState}`}><i />{scanState === "scanning" ? "Thinking" : "Ready"}</span>
                  </div>

                  <div className="thinking-prompt">
                    <span>AGENT MISSION</span>
                    <p>{scanUsesXTrace ? (analysisMode === "selected" ? `Re-evaluate ${analysisCompanies.length} selected companies using every new verified signal.` : "Scan the market, query XTrace memory, and surface beliefs that should change.") : "Scan verified market sources without querying historical deal memory."}</p>
                  </div>

                  {scanState === "idle" ? (
                    <div className="thinking-idle">
                      <p className="scan-overline">{scanUsesXTrace ? "XTRACE ON · 188 MEMORIES CONNECTED" : "XTRACE OFF · MARKET-ONLY MODE"}</p>
                      <h2>Wake the agent.<br />Find the belief that changed.</h2>
                      <p>{scanUsesXTrace ? "The agent will connect live market signals to the reasons behind past investment decisions." : "The agent will find market changes, but it cannot identify which past investment beliefs they invalidate."}</p>
                      <button className="stage-cta" onClick={() => runScan()}>Wake Agent & Scan Market</button>
                    </div>
                  ) : (
                    <div className="thinking-body" aria-label="Live analysis trace">
                      <div className="thinking-summary"><span className="thinking-loader"><i /><i /><i /></span><strong>{analysisSteps[Math.min(scanStep, analysisSteps.length - 1)].title}</strong><small>{scanUsesXTrace ? "Market intelligence + XTrace decision memory" : "Market intelligence only · XTrace off"}</small></div>
                      <div className="thinking-trace">
                        {analysisSteps.map((item, index) => {
                          const status = index < scanStep ? "complete" : index === scanStep ? "current" : "pending";
                          return <div className={`trace-step ${status} ${index === 3 && scanUsesXTrace ? "conflict" : ""}`} key={item.title}>
                            <span className="trace-status">{status === "complete" ? "✓" : status === "current" ? <i /> : `0${index + 1}`}</span>
                            <div><strong><b>›</b> {item.title}</strong><p>{item.detail}</p></div>
                          </div>;
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : !scanUsesXTrace ? (
              <article className="market-only-card">
                <div className="market-only-head"><span>✓</span><div><p>MARKET SCAN COMPLETE</p><h2>FDA review policy changed.</h2><small>Federal Register · FDA · detected 2h ago</small></div></div>
                <div className="market-only-body">
                  <section><span>VERIFIED MARKET SIGNAL</span><h3>FDA pilots accelerated review for AI-enabled diagnostics</h3><p>One material regulatory event was captured and added to the signal ledger.</p><button className="secondary-button" onClick={() => { setDrawerContext("FDA accelerated review signal"); setPanel("sources"); }}>Inspect source</button></section>
                  <aside><span>XTRACE OFF</span><strong>Impacted deal: unknown</strong><p>No decision memories were queried, so the agent cannot identify which prior belief should be revisited.</p></aside>
                </div>
                <div className="market-only-action"><div><strong>See what XTrace changes</strong><small>Connect the same signal to 188 source-linked investment memories.</small></div><button className="primary-button" onClick={() => { setXtraceEnabled(true); runScan(undefined, true); }}>Turn on XTrace & re-run</button></div>
              </article>
            ) : analysisMode === "selected" ? (
              <article className="batch-match-card">
                <div className="batch-result-head">
                  <span className="batch-result-icon">✓</span>
                  <div><p>SELECTED-COMPANY RE-EVALUATION</p><h2>{analysisCompanies.length} companies scanned against new evidence</h2><small>{analysisMemoryCount} stored memories · 8 public sources · completed just now</small></div>
                  <button onClick={() => { setSearchQuery(""); setPanel("search"); }}>Change selection</button>
                </div>
                <div className="batch-result-summary">
                  <article><span>BELIEFS REVISED</span><strong>{analysisCompanies.some((name) => ["Asteria Bio", "Arcspan Energy"].includes(name)) ? "1" : "0"}</strong><small>Requires partner review</small></article>
                  <article><span>NEW SUPPORTING FACTORS</span><strong>{Math.min(analysisCompanies.length + 1, 5)}</strong><small>Across selected companies</small></article>
                  <article><span>NO MATERIAL CHANGE</span><strong>{Math.max(analysisCompanies.length - 1, 0)}</strong><small>Thesis remains unchanged</small></article>
                </div>
                <div className="batch-company-results">
                  {analysisCompanies.map((name) => {
                    const deal = dealDirectory.find((item) => item.name === name);
                    const changed = ["Asteria Bio", "Arcspan Energy", "Torque Materials"].includes(name);
                    return <button key={name} onClick={() => { setSearchQuery(name); setPanel("search"); }}><span className="result-monogram">{name.charAt(0)}</span><span><strong>{name}</strong><small>{deal?.meta} · {deal?.memories} memories checked</small></span><em className={changed ? "changed" : "stable"}>{changed ? "New evidence" : "No material change"}</em></button>;
                  })}
                </div>
                <div className="batch-result-actions"><button className="secondary-button" onClick={() => { setSearchQuery(""); setPanel("search"); }}>Re-evaluate another set</button><button className="primary-button" onClick={() => navigateProduct("pipeline")}>Open Deals</button></div>
              </article>
            ) : (
              <article className="match-card">
                <div className="match-flash" aria-hidden="true" />
                <div className="company-row">
                  <span className="company-monogram">A</span>
                  <div>
                    <h2>Asteria Bio</h2>
                    <p>AI-assisted diagnostics · Series A</p>
                  </div>
                  <span className="status-chip">PASSED · 8 MONTHS AGO</span>
                  <span className="condition-match">Belief revised <i /></span>
                </div>

                <div className="compare-grid">
                  <section className="compare-side then-side">
                    <div className="side-heading">
                      <span>THEN / INVESTMENT MEMORY</span>
                      <span>LAST EVALUATED · 8 MO AGO</span>
                    </div>
                    <h3>Passed 8 months ago</h3>
                    <dl>
                      <div>
                        <dt>Decision reason</dt>
                        <dd><span className="belief-conflict-old">FDA pathway unclear</span></dd>
                      </div>
                      <div>
                        <dt>Revisit when</dt>
                        <dd className="key-memory">“Re-open when accelerated review expands to AI-assisted diagnostics.”</dd>
                      </div>
                    </dl>
                    <button className="evidence-pill" onClick={() => setPanel("evidence")}>
                      <i /> VSee Memory #fact_7A21 <span>Verified</span>
                    </button>
                  </section>

                  <div className="causal-bridge" aria-hidden="true">
                    <span className="bridge-line" />
                    <span className="bridge-node">REVISED</span>
                  </div>

                  <section className="compare-side now-side">
                    <div className="side-heading live-heading">
                      <span>NOW / MARKET EVIDENCE</span>
                      <span>DETECTED 2H AGO</span>
                    </div>
                    <h3><span className="belief-conflict-new">FDA pilots accelerated review for AI-enabled diagnostics</span></h3>
                    <div className="confidence-row">
                      <div className="confidence-ring"><span>High</span></div>
                      <div>
                        <strong>Old belief contradicted by new evidence</strong>
                        <p>XTrace connected the original blocker to a verified regulatory change.</p>
                      </div>
                    </div>
                    <button className="evidence-pill live-evidence" onClick={() => setPanel("evidence")}>
                      <i /> Federal Register snapshot <span>Primary</span>
                    </button>
                  </section>
                </div>

                <div className="outreach-panel">
                  <div className="outreach-label"><span>RECOMMENDED NEXT MOVE</span><strong>Re-open Asteria with the original deal team.</strong></div>
                  <div className="outreach-draft">
                    <div className="outreach-meta"><span>TO</span><strong>Asteria deal team</strong><span>SUBJECT</span><strong>{outreachSubject}</strong></div>
                    <p>{outreachBody}</p>
                  </div>
                  <div className="outreach-actions">
                    <button className="secondary-button" onClick={() => setPanel("evidence")}>Inspect evidence</button>
                    <button className={`secondary-button ${outreachCopied ? "approved" : ""}`} onClick={copyOutreachEmail}>{outreachCopied ? "✓ Email copied" : "Copy email"}</button>
                    <button className="primary-button" onClick={openOutreachEmail}>Open in email</button>
                  </div>
                </div>
              </article>
            )}

          </section>

          {scanState === "matched" && scanUsesXTrace && analysisMode === "global" && (
            <section className="deal-intelligence" id="deal-intelligence" aria-labelledby="deal-room-title">
              <div className="section-heading">
                <div>
                  <h2 id="deal-room-title">Asteria Bio · the full decision context</h2>
                  <p className="section-intro">Decision memory, live evidence, traction, terms, risks, and history—connected in one company record.</p>
                </div>
                <div className="freshness">
                  <span className="system-dot" />
                  <div><strong>Evidence current</strong><small>6 verified sources</small></div>
                </div>
              </div>

              <div className="company-context">
                <div className="context-company">
                  <span className="company-monogram">A</span>
                  <div><span className="company-intro-eyebrow">XTRACE COMPANY BRIEF</span><strong>Asteria Bio</strong><small>AI-assisted diagnostics · San Francisco</small><span className="company-capability-tags"><i>Decision memory</i><i>Live signals</i><i>Source lineage</i></span></div>
                </div>
                <div className="context-stat"><span>STAGE</span><strong>Series A</strong></div>
                <div className="context-stat"><span>RAISING</span><strong>$12M</strong></div>
                <div className="context-stat"><span>DEAL OWNER</span><strong>KM</strong></div>
                <button className={`agenda-button ${inAgenda ? "added" : ""}`} onClick={() => { setInAgenda(!inAgenda); notify(inAgenda ? "ASTERIA BIO REMOVED FROM IC AGENDA" : "ASTERIA BIO ADDED TO MONDAY IC AGENDA"); }}>{inAgenda ? "✓ On IC agenda" : "+ Add to IC agenda"}</button>
              </div>
              <div className="record-lineage" aria-label="Company profile sources">
                <strong>PROFILE VERIFIED · 3 SOURCES</strong>
                <button onClick={() => { setDrawerContext("Asteria Bio · Company profile sources"); setPanel("sources"); }}>View source lineage</button>
              </div>

              <div className="detail-tabs" role="tablist" aria-label="Company intelligence">
                {detailTabs.map((tab) => (
                  <button
                    key={tab.id}
                    role="tab"
                    aria-selected={detailTab === tab.id}
                    className={detailTab === tab.id ? "active" : ""}
                    onClick={() => setDetailTab(tab.id)}
                  >
                    {tab.label}{tab.count && <span>{tab.count}</span>}
                  </button>
                ))}
              </div>

              <div className="detail-panel" role="tabpanel">
                {detailTab === "overview" && (
                  <div className="overview-layout">
                    <div className="snapshot-grid">
                      <article className="snapshot-card signal-card">
                        <span>WHY NOW</span>
                        <strong>Regulatory unlock</strong>
                        <p>The exact revisit condition from the November pass is now materially satisfied.</p>
                        <button onClick={() => setPanel("evidence")}>View evidence chain</button>
                      </article>
                      <article className="snapshot-card">
                        <span>TRACTION</span>
                        <strong>$2.4M ARR</strong>
                        <p><em>+38% QoQ</em> · 9 hospital pilots · 67% pilot-to-contract conversion</p>
                        <button onClick={() => setDetailTab("traction")}>Open operating metrics</button>
                      </article>
                      <article className="snapshot-card">
                        <span>DEAL ECONOMICS</span>
                        <strong>$48M pre</strong>
                        <p>$12M raise · 18% target ownership · 2.9× ARR multiple at entry</p>
                        <button onClick={() => setDetailTab("deal")}>Inspect round terms</button>
                      </article>
                      <article className="snapshot-card risk-card">
                        <span>WHAT COULD BREAK</span>
                        <strong>3 open risks</strong>
                        <p>Clinical evidence depth, customer concentration, and lead-investor timing.</p>
                        <button onClick={() => setDetailTab("risks")}>Review diligence gaps</button>
                      </article>
                    </div>
                    <div className="source-footer">Sources: official website · founder deck · CRM interactions · Federal Register · company KPI update <span>Every displayed fact retains source lineage</span></div>
                  </div>
                )}

                {detailTab === "traction" && (
                  <div className="traction-layout">
                    <div className="metric-board">
                      {[
                        ["ARR", "$2.4M", "+38% QoQ", "positive"],
                        ["Gross margin", "71%", "+4 pts", "positive"],
                        ["Hospital pilots", "9", "6 converting", "positive"],
                        ["Sales cycle", "7.2 mo", "-1.1 mo", "positive"],
                        ["Net retention", "124%", "12-mo cohort", "neutral"],
                        ["Monthly burn", "$420k", "9 mo runway", "warning"],
                      ].map(([label, value, delta, tone]) => (
                        <article className="operating-metric" key={label}>
                          <span>{label}</span><strong>{value}</strong><small className={tone}>{delta}</small>
                        </article>
                      ))}
                    </div>
                    <div className="cohort-card">
                      <div className="panel-label"><span>PILOT CONVERSION</span><small>Last 4 quarters</small></div>
                      <div className="bar-chart" aria-label="Pilot conversion grew from 31 to 67 percent">
                        {[31, 42, 54, 67].map((value, index) => <i key={value} style={{ height: `${value}%` }}><span>{value}%</span><b>Q{index + 1}</b></i>)}
                      </div>
                      <p>Conversion improved after the team added reimbursement support to enterprise onboarding.</p>
                    </div>
                    <div className="source-footer">Founder update · CRM notes · Pipeline export <span>Metrics dated Jul 15, 2026</span></div>
                  </div>
                )}

                {detailTab === "deal" && (
                  <div className="deal-layout">
                    <div className="terms-table">
                      {[
                        ["Round", "Series A", "New preferred"],
                        ["Raise", "$12M", "Lead sought"],
                        ["Pre-money", "$48M", "2.9× current ARR"],
                        ["Target ownership", "18%", "$10.5M check"],
                        ["Pro rata", "Included", "Major investors"],
                        ["Runway post-close", "28 months", "Base case"],
                      ].map(([label, value, note]) => <div key={label}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>)}
                    </div>
                    <div className="deal-sidebar">
                      <div className="panel-label"><span>ROUND DYNAMICS</span><small>As of 2 days ago</small></div>
                      <p><strong>Soft-circled:</strong> $4.5M</p>
                      <p><strong>Expected close:</strong> 5 weeks</p>
                      <p><strong>Known interest:</strong> 3 healthcare funds</p>
                      <div className="price-flag"><span>!</span><p><strong>Price needs work</strong><br />Entry multiple is 24% above median for comparable clinical AI Series A rounds.</p></div>
                    </div>
                    <div className="source-footer">Founder deck · Financing email · Comparable set <span>Terms are indicative, not final</span></div>
                  </div>
                )}

                {detailTab === "risks" && (
                  <div className="risk-layout">
                    {[
                      { level: "HIGH", title: "Clinical evidence remains narrow", copy: "Retrospective study covers two hospital systems; prospective multi-site validation is not complete.", ask: "Request protocol, enrollment progress, and interim sensitivity/specificity." },
                      { level: "MED", title: "Customer concentration", copy: "Top two health systems represent 46% of contracted ARR.", ask: "Review renewal clauses and downside case if the largest system churns." },
                      { level: "MED", title: "Lead investor not secured", copy: "Three funds are engaged, but none has issued a term sheet.", ask: "Confirm decision timelines and whether valuation flex unlocks a lead." },
                    ].map((risk, index) => (
                      <article className="risk-item" key={risk.title}>
                        <span className={`risk-level ${risk.level === "HIGH" ? "high" : "medium"}`}>{risk.level}</span>
                        <div><h3>{risk.title}</h3><p>{risk.copy}</p><small>NEXT QUESTION · {risk.ask}</small></div>
                        <button onClick={() => {
                          setTasks((current) => current.map((done, taskIndex) => taskIndex === index ? !done : done));
                        }} className={tasks[index] ? "done" : ""}>{tasks[index] ? "✓ Added" : "+ Diligence"}</button>
                      </article>
                    ))}
                    <div className="risk-summary"><strong>{tasks.filter(Boolean).length}/3</strong><span>Diligence questions ready for the re-evaluation email</span><button onClick={focusOutreach}>Review email</button></div>
                  </div>
                )}

                {detailTab === "history" && (
                  <div className="history-layout">
                    <div className="timeline">
                      {[
                        ["JUL 21, 2026", "Belief revised", "XTrace connected a market signal to the team’s documented revisit condition.", "live"],
                        ["NOV 18, 2025", "Investment committee passed", "Regulatory pathway was the decisive unresolved risk.", ""],
                        ["NOV 12, 2025", "Partner meeting", "Team interest was strong; pricing and FDA path remained open.", ""],
                        ["OCT 29, 2025", "Founder introduction", "Inbound from Meridian Health CEO; initial product demo completed.", ""],
                      ].map(([date, title, copy, tone]) => (
                        <article className={tone} key={date}>
                          <span>{date}</span><i /><div><h3>{title}</h3><p>{copy}</p></div>
                        </article>
                      ))}
                    </div>
                    <div className="memory-summary">
                      <div className="panel-label"><span>CAPTURED DEAL HISTORY</span><small>Synthesized · Source-linked</small></div>
                      <div className="decision-memory-label"><span>DECISION MEMORY</span><small>Confirmed Nov 18, 2025</small></div>
                      <h2>Pass — regulatory timing made the opportunity uninvestable.</h2>
                      <p className="decision-memory-copy">Across the IC memo, partner notes, founder materials, and CRM history, the team consistently believed in the clinical need and founders. The unresolved FDA pathway—not product quality—drove the pass.</p>
                      <div className="revisit-condition">
                        <span>REVISIT CONDITION</span>
                        <strong>Re-open when accelerated review expands to AI-assisted diagnostics.</strong>
                      </div>
                      <div className="evidence-doc-heading"><span>DETAILED EVIDENCE</span><small>4 linked documents</small></div>
                      <div className="memory-documents">
                        {decisionDocuments.map((document) => (
                          <button key={document.title} onClick={() => setPanel("evidence")}>
                            <span>{document.code}</span><span><strong>{document.title}</strong><small>{document.meta}</small></span>
                          </button>
                        ))}
                      </div>
                      <button className="inspect-memory" onClick={() => setPanel("evidence")}>Inspect full evidence chain</button>
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}
          </>}

          {view === "pipeline" && (
            <section className="workspace-view" aria-labelledby="pipeline-title">
              <div className="view-heading">
                <div><h1 id="pipeline-title">Deals</h1><p>Pipeline status, decision memory, and new evidence—connected in one company record.</p></div>
                <div className="view-actions">
                  <button className="secondary-button view-action" onClick={exportMemoryCoverage}>Export CSV</button>
                  <button className="secondary-button view-action" onClick={() => setPanel("search")}>Search deals</button>
                  <button className="primary-button view-action" onClick={() => setPanel("newDeal")}>+ Add company</button>
                </div>
              </div>

              {batchReview === "complete" && <div className="batch-review-banner complete"><span>✓</span><div><strong>{batchCompanies}-company re-evaluation complete</strong><small>Only the selected companies were analyzed.</small></div><button onClick={() => { setView("overview"); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Review analysis</button></div>}

              <div className="table-toolbar">
                <div className="filter-group">{["All", "Evaluating", "Interested", "Watching", "Invested", "Passed"].map((filter) => <button key={filter} className={dealFilter === filter ? "active" : ""} onClick={() => setDealFilter(filter)}>{filter === "All" ? "All deals" : filter}</button>)}</div>
                <span>{filteredWorkspaceDeals.length} companies · {filteredMemoryCount} source-linked memories</span>
              </div>
              <div className="data-table unified-deals-table" role="table" aria-label="Deals workspace">
                <div className="data-row table-head" role="row"><span>Company</span><span>Workflow</span><span>Status</span><span>Owner</span><span>Next action</span><span>Target check</span><span>Decision memory</span></div>
                {filteredWorkspaceDeals.map((deal) => (
                  <button className={`data-row ${deal.alert !== "—" ? "has-new-evidence" : ""}`} role="row" key={deal.name} onClick={deal.name === "Asteria Bio" ? openAsteria : () => openActivity(`${deal.name} · Deal record`)}>
                    <span><span className="result-monogram">{deal.name.charAt(0)}</span><span><strong>{deal.name}</strong>{deal.alert !== "—" && <em className="new-evidence-badge">New evidence</em>}<small>{deal.sector} · {deal.round}</small></span></span>
                    <span><em>{deal.workflow}</em></span><span><em>{deal.status}</em></span><span>{deal.owner}</span><span><strong>{deal.next}</strong><small>Last touch {deal.last}</small></span><span>{deal.amount}</span><span className="memory-cell"><strong>{deal.memories} memories</strong><small>{deal.coverage}% captured</small></span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {view === "signals" && (
            <section className="workspace-view" aria-labelledby="signals-title">
              <div className="view-heading">
                <div><h1 id="signals-title">Market signals</h1><p>Verified events prioritized by relevance to invested, interested, active, watched, and passed companies.</p></div>
                <button className="primary-button view-action" onClick={() => { setView("overview"); runScan(); }}>Run analysis</button>
              </div>

              <div className="view-health-row">
                <div><span className="system-dot" /><p><strong>Federal Register</strong><small>Healthy · synced 2h ago</small></p></div>
                <div><span className="system-dot" /><p><strong>SEC EDGAR</strong><small>Healthy · synced 3h ago</small></p></div>
                <div><span className="system-dot" /><p><strong>Configured RSS</strong><small>Healthy · synced 42m ago</small></p></div>
                <div className="delayed"><span>!</span><p><strong>Crunchbase</strong><small>Delayed · retry scheduled</small></p></div>
              </div>

              <div className="table-toolbar">
                <div className="filter-group">
                  {["All", "Regulatory", "Technology", "Demand", "Funding"].map((filter) => <button key={filter} className={signalFilter === filter ? "active" : ""} onClick={() => setSignalFilter(filter)}>{filter}</button>)}
                </div>
                <span>{marketSignals.filter((signal) => signalFilter === "All" || signal.category === signalFilter).length} signals · Last 14 days</span>
              </div>

              <div className="data-table signal-table" role="table" aria-label="Market signals">
                <div className="data-row table-head" role="row"><span>Signal</span><span>Scope</span><span>Deal impact</span><span>Confidence</span><span>Evidence</span><span>Observed</span></div>
                {marketSignals.filter((signal) => signalFilter === "All" || signal.category === signalFilter).map((signal, index) => (
                  <button className={`data-row ${signal.tone}`} role="row" key={signal.title} onClick={index === 0 ? openAsteria : () => { setDrawerContext(signal.title); setPanel("sources"); } }>
                    <span><i className="row-dot" /><span><strong>{signal.title}</strong><small>{signal.category}</small></span></span>
                    <span><em>{signal.scope}</em></span><span>{signal.deals}</span><span className={signal.confidence === "High" ? "high-copy" : ""}>{signal.confidence}</span><span>{signal.sources}</span><span>{signal.time}</span>
                  </button>
                ))}
              </div>

            </section>
          )}

        </main>
      </div>

      {panel && (
        <div className="overlay" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setPanel(null);
        }}>
          <section className={`drawer ${panel}`} role="dialog" aria-modal="true" aria-labelledby="drawer-title">
            <button className="drawer-close" onClick={() => setPanel(null)} aria-label="Close panel">×</button>
            {panel === "search" ? (
              <>
                <p className="drawer-overline">DEAL MEMORY / INDUSTRY-AWARE SEARCH</p>
                <h2 id="drawer-title">Find every related company in fund memory.</h2>
                <p className="drawer-lede">Search by company, industry, value-chain component, concern, or thesis. Results include invested, interested, active, watched, and passed companies.</p>
                <label className="search-field">
                  <span>⌕</span>
                  <input autoFocus value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Try “automotive industry”, “healthcare”, or “developer tools”" />
                  <kbd>ESC</kbd>
                </label>
                <div className="search-suggestions"><span>TRY</span><button onClick={() => setSearchQuery("automotive industry")}>Automotive industry</button><button onClick={() => setSearchQuery("healthcare")}>Healthcare</button><button onClick={() => setSearchQuery("developer tools")}>Developer tools</button></div>
                {searchQuery && <div className="semantic-scope"><span>RELATED INDUSTRY SCOPE</span><p>{searchQuery.toLowerCase().includes("auto") ? "Automotive · engines · chassis · batteries · EV infrastructure · manufacturing automation" : "Company descriptions, industry tags, interaction summaries, decisions, and source-linked memories"}</p></div>}
                {searchResults.length > 0 && <div className="search-selection-toolbar"><span>{selectedCompanies.filter((name) => searchResults.some((deal) => deal.name === name)).length} selected</span><button onClick={() => { const names = searchResults.map((deal) => deal.name); const allSelected = names.every((name) => selectedCompanies.includes(name)); setSelectedCompanies(allSelected ? selectedCompanies.filter((name) => !names.includes(name)) : Array.from(new Set([...selectedCompanies, ...names]))); }}>{searchResults.every((deal) => selectedCompanies.includes(deal.name)) ? "Clear results" : "Select all results"}</button></div>}
                <div className="deal-results">
                  {searchResults.map((deal) => (
                    <div className={`deal-result-row ${selectedCompanies.includes(deal.name) ? "selected" : ""}`} key={deal.name}>
                      <button className="result-selector" aria-label={`Select ${deal.name} for re-evaluation`} aria-pressed={selectedCompanies.includes(deal.name)} onClick={() => toggleSelectedCompany(deal.name)}>{selectedCompanies.includes(deal.name) ? "✓" : ""}</button>
                      <button className="result-open" onClick={deal.name === "Asteria Bio" ? openAsteria : () => openActivity(`${deal.name} · Deal Memory`)}>
                        <span className="result-monogram">{deal.name.charAt(0)}</span>
                        <span><strong>{deal.name}</strong><small>{deal.meta} · {deal.memories} memories</small></span>
                        <em className={deal.tone}>{deal.status}</em>
                      </button>
                    </div>
                  ))}
                  {searchResults.length === 0 && <div className="no-results"><strong>No related companies found</strong><small>Try a broader industry, component, concern, or thesis keyword.</small></div>}
                </div>
                {searchResults.length > 0 && <button className="batch-review-button" disabled={!selectedCompanies.length || !xtraceEnabled} onClick={startBatchReassessment}><span>↻</span><span><strong>{!xtraceEnabled ? "Turn on XTrace to re-evaluate" : selectedCompanies.length ? `Re-evaluate ${selectedCompanies.length} selected ${selectedCompanies.length === 1 ? "company" : "companies"}` : "Select companies to re-evaluate"}</strong><small>Analyze only the selected companies and their stored memories</small></span></button>}
                <p className="search-footnote">{searchResults.length} companies found · All statuses included</p>
              </>
            ) : panel === "help" ? (
              <>
                <p className="drawer-overline">VSEE HELP</p>
                <h2 id="drawer-title">What would you like to do?</h2>
                <p className="drawer-lede">Jump directly into the core workflows. Keyboard search is available anywhere with ⌘K.</p>
                <div className="action-list">
                  <button onClick={() => { setPanel(null); navigateProduct("pipeline"); }}><strong>Review deals</strong><small>See workflow, status, decision memory, and new evidence in one place.</small></button>
                  <button onClick={() => setPanel("search")}><strong>Search Deal Memory</strong><small>Find companies by name, industry, component, or thesis.</small></button>
                  <button onClick={() => { setPanel(null); setView("overview"); runScan(); }}><strong>Run a global analysis</strong><small>Compare all eight companies with the latest verified signals.</small></button>
                </div>
              </>
            ) : panel === "notifications" ? (
              <>
                <p className="drawer-overline">NOTIFICATIONS / {reviewed ? "00" : "01"} UNREAD</p>
                <h2 id="drawer-title">Partner review queue</h2>
                <p className="drawer-lede">Only material decision changes and assigned diligence items appear here.</p>
                <div className="notification-card"><span>{reviewed ? "READ" : "NEW"}</span><div><strong>Asteria Bio · Belief revised</strong><p>XTrace connected the documented FDA revisit condition to new primary-source evidence.</p><small>2h ago · Assigned to KM</small></div><button onClick={openAsteria}>Review</button></div>
                <button className="drawer-secondary" onClick={() => { setReviewed(true); setPanel(null); notify("ALL NOTIFICATIONS MARKED READ"); }}>Mark all as read</button>
              </>
            ) : panel === "sources" ? (
              <>
                <p className="drawer-overline">SOURCE RECORD</p>
                <h2 id="drawer-title">{drawerContext || "Verified source ledger"}</h2>
                <p className="drawer-lede">Every public fact retains publisher, publication date, retrieval time, and its original URL.</p>
                <div className="source-ledger">
                  <a href="https://www.federalregister.gov/" target="_blank" rel="noreferrer"><span>PRIMARY</span><strong>Federal Register</strong><small>Regulatory notice · retrieved Jul 21, 2026</small></a>
                  <a href="https://www.fda.gov/" target="_blank" rel="noreferrer"><span>PRIMARY</span><strong>U.S. Food & Drug Administration</strong><small>Program guidance · retrieved Jul 21, 2026</small></a>
                  <a href="https://www.sec.gov/edgar/search/" target="_blank" rel="noreferrer"><span>PRIMARY</span><strong>SEC EDGAR</strong><small>Company filings · synced Jul 21, 2026</small></a>
                  <button onClick={() => { setPanel("activity"); setDrawerContext("Internal source lineage"); }}><span>INTERNAL</span><strong>Founder deck + CRM record</strong><small>Permissioned fund memory · verified Jul 15, 2026</small></button>
                </div>
              </>
            ) : panel === "activity" ? (
              <>
                <p className="drawer-overline">ACTIVITY & LINEAGE</p>
                <h2 id="drawer-title">{drawerContext || "Activity history"}</h2>
                <p className="drawer-lede">A complete, timestamped record of changes, sources, ownership, and decisions.</p>
                <div className="activity-timeline">
                  <article><span>14:34</span><div><strong>Evidence refreshed</strong><p>Public sources and stored company memories synchronized.</p></div></article>
                  <article><span>11:20</span><div><strong>Partner note added</strong><p>Next diligence question assigned to the deal owner.</p></div></article>
                  <article><span>JUL 21</span><div><strong>Company record verified</strong><p>Stage, owner, and source lineage confirmed.</p></div></article>
                </div>
                <button className="drawer-primary" onClick={() => { setPanel(null); exportActivityLog(); }}>Export activity log</button>
              </>
            ) : panel === "newDeal" ? (
              <>
                <p className="drawer-overline">NEW COMPANY</p>
                <h2 id="drawer-title">Create a deal record</h2>
                <p className="drawer-lede">Start with the canonical company record. Memories and source lineage can be attached after creation.</p>
                <form className="new-deal-form" onSubmit={(event) => { event.preventDefault(); setPanel(null); notify("NEW COMPANY ADDED TO PIPELINE · STAGE: NEW"); }}>
                  <label><span>Company name</span><input required placeholder="Company name" /></label>
                  <label><span>Sector</span><input required placeholder="e.g. Climate software" /></label>
                  <label><span>Stage</span><select defaultValue="Seed"><option>Pre-seed</option><option>Seed</option><option>Series A</option><option>Series B</option></select></label>
                  <label><span>Owner</span><select defaultValue="KM"><option>KM</option><option>JL</option><option>AP</option></select></label>
                  <button className="drawer-primary" type="submit">Create company record</button>
                </form>
              </>
            ) : (
              <>
                <p className="drawer-overline">DECISION MEMORY / 04 INTERNAL DOCS + 01 MARKET SOURCE</p>
                <h2 id="drawer-title">Docs behind the decision.</h2>
                <p className="drawer-lede">The decision memory is a source-linked synthesis. Expand any document to inspect the exact excerpt and lineage used by XTrace.</p>
                <div className="decision-memory-evidence">
                  <span>SYNTHESIZED DECISION MEMORY</span>
                  <strong>Pass — regulatory timing made the opportunity uninvestable.</strong>
                  <p>Product quality and founder conviction remained positive. The unclear FDA pathway was the consistent blocker across the fund’s documentation.</p>
                  <small>#decision_ASTERIA_2025_11 · Confirmed Nov 18, 2025</small>
                </div>
                <div className="evidence-document-heading"><span>SUPPORTING DEAL DOCUMENTS</span><small>14 cited excerpts</small></div>
                <div className="evidence-documents">
                  {decisionDocuments.map((document, index) => (
                    <details key={document.title} open={index === 0}>
                      <summary>
                        <span>{document.code}</span>
                        <span><strong>{document.title}</strong><small>{document.meta}</small></span>
                        <i />
                      </summary>
                      <div>
                        <blockquote>“{document.excerpt}”</blockquote>
                        <small>{document.lineage}</small>
                      </div>
                    </details>
                  ))}
                </div>
                <div className="evidence-document-heading"><span>NEW MARKET SOURCE</span><small>Detected 2h ago</small></div>
                <a className="market-source-document" href="https://www.federalregister.gov/" target="_blank" rel="noreferrer">
                  <span>FR</span>
                  <span><strong>Federal Register · Accelerated review pilot</strong><small>Primary source · Retrieved Jul 21, 2026</small><p>Eligibility expands to qualifying AI-enabled diagnostic tools, directly addressing the recorded revisit condition.</p></span>
                </a>
                <div className="model-note">
                  <span>EVIDENCE ASSESSMENT</span>
                  <p>The event does not guarantee approval. It removes the precise regulatory uncertainty documented in the original pass decision, making a fresh diligence call actionable.</p>
                </div>
                <button className="drawer-primary" onClick={focusOutreach}>Use email template</button>
              </>
            )}
          </section>
        </div>
      )}

      <div className={`toast ${toast ? "show" : ""}`} role="status">
        <span>✓</span>{toast}
      </div>
    </div>
  );
}
