"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";

type ScanState = "idle" | "scanning" | "matched";
type Panel = "evidence" | "brief" | "search" | null;
type DetailTab = "overview" | "traction" | "deal" | "risks" | "history";
type AppView = "overview" | "signals" | "deals" | "reports";

const scanCopy = [
  "Indexing verified market signals",
  "Comparing against 486 decision memories",
  "Testing 12 revisit conditions",
];

const dealDirectory = [
  { name: "Asteria Bio", meta: "AI diagnostics · Series A", status: "Decision delta", tone: "signal" },
  { name: "Northstar Robotics", meta: "Industrial automation · Seed", status: "Watching", tone: "neutral" },
  { name: "Arcspan Energy", meta: "Grid software · Series B", status: "Evaluating", tone: "neutral" },
  { name: "Harbor AI", meta: "Security infrastructure · Seed", status: "Passed", tone: "neutral" },
];

const detailTabs: Array<{ id: DetailTab; label: string; count?: string }> = [
  { id: "overview", label: "IC snapshot" },
  { id: "traction", label: "Traction" },
  { id: "deal", label: "Deal terms" },
  { id: "risks", label: "Risks", count: "3" },
  { id: "history", label: "Decision history" },
];

const marketSignals = [
  { title: "FDA pilots accelerated review for AI-enabled diagnostics", category: "Regulatory", scope: "Watchlist", deals: "1 deal", confidence: "High", sources: "2 primary", time: "2h ago", tone: "signal" },
  { title: "Enterprise inference prices fall across major cloud providers", category: "Technology", scope: "Global", deals: "3 deals", confidence: "High", sources: "3 sources", time: "6h ago", tone: "neutral" },
  { title: "Hospital IT budgets shift toward clinical automation", category: "Demand", scope: "Watchlist", deals: "2 deals", confidence: "Medium", sources: "1 source", time: "1d ago", tone: "neutral" },
  { title: "Series A median valuations hold flat in vertical AI", category: "Funding", scope: "Global", deals: "4 deals", confidence: "Medium", sources: "2 sources", time: "2d ago", tone: "neutral" },
];

const workspaceDeals = [
  { name: "Asteria Bio", sector: "AI diagnostics", stage: "Series A", status: "Passed", owner: "KM", last: "8 mo", memories: "14", coverage: 96, alert: "1 new" },
  { name: "Northstar Robotics", sector: "Industrial automation", stage: "Seed", status: "Watching", owner: "JL", last: "42d", memories: "31", coverage: 100, alert: "—" },
  { name: "Arcspan Energy", sector: "Grid software", stage: "Series B", status: "Evaluating", owner: "KM", last: "5d", memories: "18", coverage: 92, alert: "—" },
  { name: "Harbor AI", sector: "Security infrastructure", stage: "Seed", status: "Passed", owner: "AP", last: "4 mo", memories: "22", coverage: 88, alert: "—" },
  { name: "Cinder Systems", sector: "Developer tools", stage: "Series A", status: "Invested", owner: "JL", last: "8d", memories: "47", coverage: 100, alert: "—" },
];

export default function Home() {
  const [view, setView] = useState<AppView>("overview");
  const [scanState, setScanState] = useState<ScanState>("idle");
  const [scanStep, setScanStep] = useState(0);
  const [panel, setPanel] = useState<Panel>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>("overview");
  const [searchQuery, setSearchQuery] = useState("");
  const [tasks, setTasks] = useState([false, false, false]);
  const [reviewed, setReviewed] = useState(false);
  const [signalFilter, setSignalFilter] = useState("All");
  const [toast, setToast] = useState("");
  const timers = useRef<number[]>([]);

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

  function runScan() {
    if (scanState === "scanning") return;
    clearTimers();
    setPanel(null);
    setToast("");
    setScanStep(0);
    setScanState("scanning");

    timers.current.push(
      window.setTimeout(() => setScanStep(1), 760),
      window.setTimeout(() => setScanStep(2), 1510),
      window.setTimeout(() => {
        setScanStep(3);
        setScanState("matched");
      }, 2380),
    );
  }

  function replay() {
    clearTimers();
    setPanel(null);
    setToast("");
    setScanStep(0);
    setScanState("idle");
  }

  function notify(message: string) {
    setToast(message);
    timers.current.push(window.setTimeout(() => setToast(""), 3200));
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
    setScanStep(3);
    setScanState("matched");
    setView("overview");
    setPanel(null);
    window.setTimeout(() => document.querySelector(".match-card")?.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
  }

  return (
    <div className="app-shell">
      <aside className="rail" aria-label="Primary navigation">
        <button className="brand-lockup" aria-label="VSee overview" onClick={() => navigateProduct("overview")}>
          <span className="brand-mark"><i><b>SL</b></i></span>
          <span className="brand-copy"><strong>VSee</strong><small>Decision intelligence</small></span>
        </button>
        <p className="nav-section-label">WORKSPACE</p>
        <nav className="rail-nav" aria-label="Product areas">
          <button className={`rail-item ${view === "overview" ? "active" : ""}`} onClick={() => navigateProduct("overview")}><span>⌂</span><b>Overview</b>{!reviewed && <em>1</em>}</button>
          <button className={`rail-item ${view === "signals" ? "active" : ""}`} onClick={() => navigateProduct("signals")}><span>↗</span><b>Market signals</b></button>
          <button className={`rail-item ${view === "deals" ? "active" : ""}`} onClick={() => navigateProduct("deals")}><span>□</span><b>Deal memory</b></button>
          <button className={`rail-item ${view === "reports" ? "active" : ""}`} onClick={() => navigateProduct("reports")}><span>≡</span><b>Reports & briefs</b></button>
        </nav>
        <div className="rail-footer">
          <button className="source-health" onClick={() => navigateProduct("signals")}>
            <span className="system-dot" />
            <span><strong>Sources healthy</strong><small>3 of 4 connected</small></span>
          </button>
          <div className="workspace-user"><span className="avatar">KM</span><span><strong>Kayne M.</strong><small>Partner · Sample workspace</small></span></div>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div className="workspace-crumb"><strong>North Ridge Ventures</strong><span>/</span><small>Fund II</small></div>
          <span className="demo-label">SAMPLE WORKSPACE</span>
          <div className="top-actions">
            <button className="memory-search" onClick={() => setPanel("search")} aria-label="Search deal memory">
              <span>⌕</span> Search companies, decisions, or concerns <kbd>⌘ K</kbd>
            </button>
            <span className="index-status">
              {scanState === "scanning" ? "ANALYSIS · PROCESSING" : "LAST SYNC · 2H AGO"}
            </span>
            <button className={`scan-button ${scanState === "scanning" ? "scanning" : ""}`} onClick={() => { setView("overview"); runScan(); }} disabled={scanState === "scanning"}>
              <span className="button-dot" />
              {scanState === "scanning" ? "Analyzing…" : "Run analysis"}
            </button>
          </div>
        </header>

        <main className="product-main">
          {view === "overview" && <>
          <section className="product-heading" aria-labelledby="hero-title">
            <div>
              <p className="eyebrow">OVERVIEW</p>
              <h1 id="hero-title">Decision intelligence</h1>
              <p className="subline">One high-confidence change requires partner review. All other monitored deals are within their expected conditions.</p>
            </div>
            <div className="heading-actions">
              <span>WEDNESDAY · JUL 22, 2026</span>
              <button onClick={() => setPanel("search")}>Open deal memory</button>
            </div>
          </section>

          <section className="kpi-grid" aria-label="Workspace health">
            <article><span>REVIEW QUEUE</span><strong className="signal">{reviewed ? "0" : "1"}</strong><small>{reviewed ? "All caught up" : "High-confidence alert"}</small></article>
            <article><span>MONITORED DEALS</span><strong>12</strong><small>4 passed · 3 watching</small></article>
            <article><span>MEMORY COVERAGE</span><strong>96%</strong><small>486 verified memories</small></article>
            <article><span>SOURCE HEALTH</span><strong>3/4</strong><small className="warning-copy">1 source delayed</small></article>
          </section>

          <section className={`signal-zone ${scanState}`} aria-live="polite">
            <div className="signal-meta">
              <span className="signal-kicker">
                <i />
                {scanState === "matched" ? "DECISION DELTA DETECTED" : scanState === "scanning" ? "SCANNING DECISION MEMORY" : "READY TO COMPARE"}
              </span>
              <span>JUL 21, 2026 · 14:32 PT</span>
            </div>

            {scanState !== "matched" ? (
              <div className={`scan-stage ${scanState}`}>
                <div className="radar" aria-hidden="true">
                  <span className="radar-ring ring-one" />
                  <span className="radar-ring ring-two" />
                  <span className="radar-ring ring-three" />
                  <span className="radar-axis horizontal" />
                  <span className="radar-axis vertical" />
                  <span className="radar-sweep" />
                  <span className="radar-core">SL</span>
                </div>
                <div className="scan-copy">
                  {scanState === "idle" ? (
                    <>
                      <p className="scan-overline">486 INVESTMENT MEMORIES ONLINE</p>
                      <h2>Find the decision<br />the market just changed.</h2>
                      <p>Twelve historical deals are ready to compare against today&apos;s verified market signals.</p>
                      <button className="stage-cta" onClick={runScan}>Begin comparison <span>→</span></button>
                    </>
                  ) : (
                    <>
                      <p className="scan-overline active-copy">LIVE ANALYSIS</p>
                      <h2>{scanCopy[Math.min(scanStep, 2)]}</h2>
                      <div className="pipeline" aria-label="Analysis progress">
                        {scanCopy.map((step, index) => (
                          <div className={`pipeline-step ${index < scanStep ? "complete" : index === scanStep ? "current" : ""}`} key={step}>
                            <span>{index < scanStep ? "✓" : `0${index + 1}`}</span>
                            <p>{step}</p>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
                <div className="memory-samples" aria-hidden="true">
                  <span style={{ "--x": "8%", "--y": "18%", "--d": "0s" } as CSSProperties}>Northstar Robotics</span>
                  <span style={{ "--x": "67%", "--y": "13%", "--d": ".25s" } as CSSProperties}>Asteria Bio</span>
                  <span style={{ "--x": "73%", "--y": "72%", "--d": ".5s" } as CSSProperties}>Arcspan Energy</span>
                  <span style={{ "--x": "12%", "--y": "78%", "--d": ".75s" } as CSSProperties}>Harbor AI</span>
                </div>
              </div>
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
                  <span className="condition-match">Condition matched <i /></span>
                </div>

                <div className="compare-grid">
                  <section className="compare-side then-side">
                    <div className="side-heading">
                      <span>THEN / INVESTMENT MEMORY</span>
                      <span>NOV 18, 2025</span>
                    </div>
                    <h3>Passed 8 months ago</h3>
                    <dl>
                      <div>
                        <dt>Decision reason</dt>
                        <dd>FDA pathway unclear</dd>
                      </div>
                      <div>
                        <dt>Revisit when</dt>
                        <dd className="key-memory">“Re-open when accelerated review expands to AI-assisted diagnostics.”</dd>
                      </div>
                    </dl>
                    <button className="evidence-pill" onClick={() => setPanel("evidence")}>
                      <i /> XTrace Memory #fact_7A21 <span>Verified</span>
                    </button>
                  </section>

                  <div className="causal-bridge" aria-hidden="true">
                    <span className="bridge-line" />
                    <span className="bridge-node">MATCH</span>
                  </div>

                  <section className="compare-side now-side">
                    <div className="side-heading live-heading">
                      <span>NOW / MARKET EVIDENCE</span>
                      <span>DETECTED 2H AGO</span>
                    </div>
                    <h3>FDA pilots accelerated review for AI-enabled diagnostics</h3>
                    <div className="confidence-row">
                      <div className="confidence-ring"><span>91%</span></div>
                      <div>
                        <strong>High confidence match</strong>
                        <p>Regulatory language and sector threshold both satisfied.</p>
                      </div>
                    </div>
                    <button className="evidence-pill live-evidence" onClick={() => setPanel("evidence")}>
                      <i /> Federal Register snapshot <span>Primary</span>
                    </button>
                  </section>
                </div>

                <div className="recommendation-row">
                  <div>
                    <span>RECOMMENDED NEXT MOVE</span>
                    <p>Book a 30-minute re-evaluation with the original deal team.</p>
                  </div>
                  <div className="recommendation-actions">
                    <button className="secondary-button" onClick={() => setPanel("evidence")}>Inspect evidence</button>
                    <button className={`review-button ${reviewed ? "reviewed" : ""}`} onClick={() => { setReviewed(!reviewed); notify(reviewed ? "ALERT RETURNED TO REVIEW QUEUE" : "ALERT MARKED REVIEWED · AUDIT LOG UPDATED"); }}>{reviewed ? "✓ Reviewed" : "Mark reviewed"}</button>
                    <button className="primary-button" onClick={() => setPanel("brief")}>Prepare partner brief <span>→</span></button>
                  </div>
                </div>
              </article>
            )}

            <div className="ticker" aria-label="Monitored deals">
              <strong>MONITORING</strong>
              <span className={scanState === "matched" ? "hot" : ""}><i /> Asteria Bio</span>
              <span><i /> Northstar Robotics</span>
              <span><i /> Arcspan Energy</span>
              <span><i /> Harbor AI</span>
              <small>XTRACE MEMORY + VERIFIED MARKET SOURCES</small>
            </div>
          </section>

          <div className="source-notice"><span>!</span><p><strong>Crunchbase enrichment is delayed.</strong> Market analysis completed with Federal Register, SEC, and configured RSS sources.</p><button onClick={() => navigateProduct("signals")}>View source health</button></div>

          {scanState === "matched" && (
            <section className="deal-intelligence" id="deal-intelligence" aria-labelledby="deal-room-title">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">PARTNER DECISION ROOM</p>
                  <h2 id="deal-room-title">Everything that matters before the second meeting.</h2>
                </div>
                <div className="freshness">
                  <span className="system-dot" />
                  <div><strong>Evidence current</strong><small>6 sources · refreshed 2h ago</small></div>
                </div>
              </div>

              <div className="company-context">
                <div className="context-company">
                  <span className="company-monogram">A</span>
                  <div><strong>Asteria Bio</strong><small>AI-assisted diagnostics · San Francisco</small></div>
                </div>
                <div className="context-stat"><span>STAGE</span><strong>Series A</strong></div>
                <div className="context-stat"><span>RAISING</span><strong>$12M</strong></div>
                <div className="context-stat"><span>LAST TOUCH</span><strong>8 mo ago</strong></div>
                <div className="context-stat"><span>DEAL OWNER</span><strong>KM</strong></div>
                <button className="agenda-button" onClick={() => notify("ASTERIA BIO ADDED TO MONDAY IC AGENDA")}>+ Add to IC agenda</button>
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
                    <div className="conviction-card">
                      <div className="panel-label"><span>RE-ENTRY CONVICTION</span><small>Evidence weighted</small></div>
                      <div className="conviction-score"><strong>78</strong><span>/100</span><i>+17</i></div>
                      <p>Regulatory risk moved materially. Traction remains strong; entry price is the main open concern.</p>
                      <div className="score-bars">
                        {[
                          ["Team", 86], ["Market", 82], ["Product", 76], ["Traction", 88], ["Price", 64], ["Regulatory", 75],
                        ].map(([label, score]) => (
                          <div className="score-row" key={label as string}>
                            <span>{label}</span><i><b style={{ width: `${score}%` }} /></i><strong>{score}</strong>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="snapshot-grid">
                      <article className="snapshot-card signal-card">
                        <span>WHY NOW</span>
                        <strong>Regulatory unlock</strong>
                        <p>The exact revisit condition from the November pass is now materially satisfied.</p>
                        <button onClick={() => setPanel("evidence")}>View evidence chain →</button>
                      </article>
                      <article className="snapshot-card">
                        <span>TRACTION</span>
                        <strong>$2.4M ARR</strong>
                        <p><em>+38% QoQ</em> · 9 hospital pilots · 67% pilot-to-contract conversion</p>
                        <button onClick={() => setDetailTab("traction")}>Open operating metrics →</button>
                      </article>
                      <article className="snapshot-card">
                        <span>DEAL ECONOMICS</span>
                        <strong>$48M pre</strong>
                        <p>$12M raise · 18% target ownership · 2.9× ARR multiple at entry</p>
                        <button onClick={() => setDetailTab("deal")}>Inspect round terms →</button>
                      </article>
                      <article className="snapshot-card risk-card">
                        <span>WHAT COULD BREAK</span>
                        <strong>3 open risks</strong>
                        <p>Clinical evidence depth, customer concentration, and lead-investor timing.</p>
                        <button onClick={() => setDetailTab("risks")}>Review diligence gaps →</button>
                      </article>
                    </div>

                    <div className="portfolio-fit">
                      <div className="panel-label"><span>PORTFOLIO FIT</span><small>Conflict check complete</small></div>
                      <div className="fit-row positive"><span>✓</span><div><strong>No direct conflict</strong><small>0 overlapping diagnostic products across 24 active investments</small></div></div>
                      <div className="fit-row"><span>↗</span><div><strong>1 channel synergy</strong><small>Meridian Health has 43 target hospital relationships</small></div></div>
                      <div className="fit-row"><span>○</span><div><strong>Exposure remains balanced</strong><small>Healthcare represents 16% of current fund NAV</small></div></div>
                    </div>
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
                    <div className="risk-summary"><strong>{tasks.filter(Boolean).length}/3</strong><span>Diligence questions added to the re-evaluation brief</span><button onClick={() => setPanel("brief")}>Review brief →</button></div>
                  </div>
                )}

                {detailTab === "history" && (
                  <div className="history-layout">
                    <div className="timeline">
                      {[
                        ["JUL 21, 2026", "Decision delta detected", "Market signal matched the team’s documented revisit condition.", "live"],
                        ["NOV 18, 2025", "Investment committee passed", "Regulatory pathway was the decisive unresolved risk.", ""],
                        ["NOV 12, 2025", "Partner meeting", "Team conviction was strong; pricing and FDA path remained open.", ""],
                        ["OCT 29, 2025", "Founder introduction", "Inbound from Meridian Health CEO; initial product demo completed.", ""],
                      ].map(([date, title, copy, tone]) => (
                        <article className={tone} key={date}>
                          <span>{date}</span><i /><div><h3>{title}</h3><p>{copy}</p></div>
                        </article>
                      ))}
                    </div>
                    <div className="memory-summary">
                      <div className="panel-label"><span>MEMORY COVERAGE</span><small>Exact lineage</small></div>
                      <strong>14</strong><span>verified memories</span>
                      <ul><li>6 facts</li><li>3 artifacts</li><li>5 episodes</li></ul>
                      <button onClick={() => setPanel("search")}>Search all deal memory →</button>
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}
          </>}

          {view === "signals" && (
            <section className="workspace-view" aria-labelledby="signals-title">
              <div className="view-heading">
                <div><p className="eyebrow">MARKET INTELLIGENCE</p><h1 id="signals-title">Market signals</h1><p>Verified events prioritized by relevance to your active, passed, and portfolio deals.</p></div>
                <button className="primary-button view-action" onClick={() => { setView("overview"); runScan(); }}>Run analysis <span>→</span></button>
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
                  <button className={`data-row ${signal.tone}`} role="row" key={signal.title} onClick={index === 0 ? openAsteria : () => notify("SIGNAL OPENED · NO HIGH-CONFIDENCE DEAL MATCH") }>
                    <span><i className="row-dot" /><span><strong>{signal.title}</strong><small>{signal.category}</small></span></span>
                    <span><em>{signal.scope}</em></span><span>{signal.deals}</span><span className={signal.confidence === "High" ? "high-copy" : ""}>{signal.confidence}</span><span>{signal.sources}</span><span>{signal.time} <i>→</i></span>
                  </button>
                ))}
              </div>

              <div className="view-footnote"><span>Source policy</span><p>Only medium- and high-confidence events enter deal matching. Failed sources remain visible and never silently disappear from coverage.</p><button onClick={() => notify("SOURCE POLICY · AUDIT LOG OPENED")}>View audit log →</button></div>
            </section>
          )}

          {view === "deals" && (
            <section className="workspace-view" aria-labelledby="deals-title">
              <div className="view-heading">
                <div><p className="eyebrow">INSTITUTIONAL MEMORY</p><h1 id="deals-title">Deal memory</h1><p>Every decision, interaction, concern, and revisit condition—searchable across the fund.</p></div>
                <button className="secondary-button view-action" onClick={() => setPanel("search")}>Search in natural language</button>
              </div>

              <section className="memory-kpis">
                <article><span>COMPANIES</span><strong>12</strong><small>Across 4 statuses</small></article>
                <article><span>VERIFIED MEMORIES</span><strong>486</strong><small>171 facts · 92 artifacts · 223 episodes</small></article>
                <article><span>SYNC COVERAGE</span><strong>96%</strong><small>1 interaction needs retry</small></article>
                <article><span>OLDEST OPEN LOOP</span><strong>8 mo</strong><small>Asteria Bio · now triggered</small></article>
              </section>

              <div className="table-toolbar"><div className="filter-group"><button className="active">All deals</button><button>Evaluating</button><button>Watching</button><button>Passed</button><button>Invested</button></div><span>Sorted by last interaction</span></div>
              <div className="data-table deal-table" role="table" aria-label="Deal memory directory">
                <div className="data-row table-head" role="row"><span>Company</span><span>Stage</span><span>Status</span><span>Owner</span><span>Last touch</span><span>Memory coverage</span><span>Alert</span></div>
                {workspaceDeals.map((deal) => (
                  <button className={`data-row ${deal.alert !== "—" ? "signal" : ""}`} role="row" key={deal.name} onClick={deal.name === "Asteria Bio" ? openAsteria : () => notify(`${deal.name.toUpperCase()} · DEAL WORKSPACE OPENED`)}>
                    <span><span className="result-monogram">{deal.name.charAt(0)}</span><span><strong>{deal.name}</strong><small>{deal.sector}</small></span></span>
                    <span>{deal.stage}</span><span><em>{deal.status}</em></span><span>{deal.owner}</span><span>{deal.last}</span><span><i className="coverage-track"><b style={{ width: `${deal.coverage}%` }} /></i>{deal.memories} memories</span><span className={deal.alert !== "—" ? "high-copy" : ""}>{deal.alert} <i>→</i></span>
                  </button>
                ))}
              </div>
              <div className="view-footnote"><span>Canonical record</span><p>Confirmed deal fields remain distinct from AI-extracted memories. Every memory keeps its source and interaction lineage.</p><button onClick={() => notify("MEMORY LINEAGE · EXPORT PREPARED")}>Export coverage →</button></div>
            </section>
          )}

          {view === "reports" && (
            <section className="workspace-view" aria-labelledby="reports-title">
              <div className="view-heading">
                <div><p className="eyebrow">DECISION OUTPUTS</p><h1 id="reports-title">Reports & IC briefs</h1><p>Evidence-backed outputs ready for partner review, committee discussion, and follow-up.</p></div>
                <button className="primary-button view-action" onClick={() => setPanel("brief")}>New IC brief <span>→</span></button>
              </div>

              <div className="report-feature">
                <div className="report-feature-copy">
                  <span className="new-badge">NEW · DECISION DELTA</span>
                  <h2>Asteria Bio deserves partner review.</h2>
                  <p>A regulatory change directly addresses the uncertainty behind the November pass. Includes current traction, deal economics, portfolio fit, and three remaining diligence risks.</p>
                  <div><span>91% confidence</span><span>6 sources</span><span>3 open risks</span><span>Owner · KM</span></div>
                  <button className="primary-button" onClick={() => setPanel("brief")}>Open partner brief <span>→</span></button>
                </div>
                <div className="report-preview" aria-hidden="true"><span>VSEE</span><h3>Decision delta<br />Asteria Bio</h3><i /><p>THEN → NOW → NEXT MOVE</p><small>JUL 22 · FUND II</small></div>
              </div>

              <div className="reports-section-heading"><h2>Recent reports</h2><span>Showing 4 of 18</span></div>
              <div className="data-table report-table">
                <div className="data-row table-head"><span>Report</span><span>Type</span><span>Coverage</span><span>Status</span><span>Created</span><span>Owner</span></div>
                {[
                  ["Asteria Bio · Decision delta", "IC brief", "6 sources", "Ready", "Today, 14:34", "KM"],
                  ["Weekly market digest · Jul 20", "Market digest", "31 events", "Sent", "Jul 20", "System"],
                  ["Arcspan Energy · Diligence update", "Deal brief", "18 memories", "Draft", "Jul 18", "KM"],
                  ["Portfolio risk scan · Q3", "Portfolio", "24 companies", "Sent", "Jul 15", "JL"],
                ].map((report, index) => <button className="data-row" key={report[0]} onClick={index === 0 ? () => setPanel("brief") : () => notify(`${report[0].toUpperCase()} · REPORT OPENED`)}>{report.map((value, itemIndex) => <span key={value} className={itemIndex === 3 && value === "Ready" ? "high-copy" : ""}>{itemIndex === 0 ? <strong>{value}</strong> : value}{itemIndex === 5 && <i>→</i>}</span>)}</button>)}
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
                <p className="drawer-overline">DEAL MEMORY / NATURAL LANGUAGE SEARCH</p>
                <h2 id="drawer-title">Find any decision your fund has made.</h2>
                <p className="drawer-lede">Search company names, founder conversations, concerns, metrics, or the conditions that would change your mind.</p>
                <label className="search-field">
                  <span>⌕</span>
                  <input autoFocus value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Try “diagnostics with regulatory risk”" />
                  <kbd>ESC</kbd>
                </label>
                <div className="search-suggestions"><span>TRY</span><button onClick={() => setSearchQuery("passed because of regulatory risk")}>Regulatory risk</button><button onClick={() => setSearchQuery("healthcare Series A")}>Healthcare Series A</button></div>
                <div className="deal-results">
                  {dealDirectory.filter((deal) => `${deal.name} ${deal.meta} ${deal.status}`.toLowerCase().includes(searchQuery.toLowerCase()) || !searchQuery).map((deal, index) => (
                    <button key={deal.name} onClick={deal.name === "Asteria Bio" ? openAsteria : () => notify(`${deal.name.toUpperCase()} · MEMORY OPENED`)}>
                      <span className="result-monogram">{deal.name.charAt(0)}</span>
                      <span><strong>{deal.name}</strong><small>{deal.meta}</small></span>
                      <em className={deal.tone}>{deal.status}</em>
                      <i>→</i>
                    </button>
                  ))}
                </div>
                <p className="search-footnote">12 deals · 486 memories · Facts, artifacts, and episodes searched together</p>
              </>
            ) : panel === "evidence" ? (
              <>
                <p className="drawer-overline">EVIDENCE CHAIN / 02 SOURCES</p>
                <h2 id="drawer-title">Why this decision changed</h2>
                <p className="drawer-lede">VSee found a direct semantic match between the condition recorded by your deal team and a new regulatory signal.</p>
                <div className="evidence-chain">
                  <div className="chain-item">
                    <span className="chain-number">01</span>
                    <div>
                      <p>XTRACE DECISION MEMORY</p>
                      <blockquote>“Re-open when accelerated review expands to AI-assisted diagnostics.”</blockquote>
                      <small>#fact_7A21 · Confirmed Nov 18, 2025 · Exact lineage</small>
                    </div>
                  </div>
                  <div className="chain-connector"><span>CAUSAL OVERLAP · 94%</span></div>
                  <div className="chain-item live">
                    <span className="chain-number">02</span>
                    <div>
                      <p>ILLUSTRATIVE MARKET SIGNAL</p>
                      <blockquote>Accelerated review pilot expands eligibility to qualifying AI-enabled diagnostic tools.</blockquote>
                      <small>Federal Register snapshot · Observed 2h ago · Demo source</small>
                    </div>
                  </div>
                </div>
                <div className="model-note">
                  <span>MODEL ASSESSMENT</span>
                  <p>The event does not guarantee approval. It removes the precise regulatory uncertainty documented in the original pass decision, making a fresh diligence call actionable.</p>
                </div>
                <button className="drawer-primary" onClick={() => setPanel("brief")}>Turn evidence into partner brief →</button>
              </>
            ) : (
              <>
                <p className="drawer-overline">PARTNER BRIEF / READY</p>
                <h2 id="drawer-title">Asteria Bio deserves partner review.</h2>
                <p className="drawer-lede">A decision-ready brief, grounded in one historical memory and one verified market signal.</p>
                <div className="brief-card">
                  <div className="brief-meta"><span>TO</span><strong>Investment Committee</strong></div>
                  <div className="brief-meta"><span>SUBJECT</span><strong>Decision delta detected · Asteria Bio</strong></div>
                  <div className="brief-body">
                    <p><strong>What changed</strong><br />A new accelerated review pilot directly addresses the FDA-pathway uncertainty behind our November pass.</p>
                    <p><strong>Why now</strong><br />The revisit condition recorded by the deal team is now materially satisfied with 91% confidence.</p>
                    <div className="brief-facts"><span><small>ARR</small>$2.4M</span><span><small>QOQ GROWTH</small>+38%</span><span><small>PRE-MONEY</small>$48M</span><span><small>CONVICTION</small>78/100</span></div>
                    <p><strong>Remaining risk</strong><br />Clinical evidence is still narrow and the round does not yet have a committed lead.</p>
                    <p><strong>Recommended action</strong><br />Schedule a 30-minute re-evaluation with the original deal team this week.</p>
                  </div>
                  <div className="attachment-row"><span>6</span> sources and diligence questions attached</div>
                </div>
                <button className="drawer-primary send" onClick={() => {
                  setPanel(null);
                  notify("PARTNER BRIEF SENT · EVIDENCE ATTACHED");
                }}>Send to investment committee <span>→</span></button>
                <p className="demo-disclaimer">Demo interaction · no external email is sent from this website.</p>
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
