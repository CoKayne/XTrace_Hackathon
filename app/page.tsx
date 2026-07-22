"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";

type ScanState = "idle" | "scanning" | "matched";
type Panel = "evidence" | "brief" | "search" | null;
type DetailTab = "overview" | "traction" | "deal" | "risks" | "history";

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

export default function Home() {
  const [scanState, setScanState] = useState<ScanState>("idle");
  const [scanStep, setScanStep] = useState(0);
  const [panel, setPanel] = useState<Panel>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>("overview");
  const [searchQuery, setSearchQuery] = useState("");
  const [tasks, setTasks] = useState([false, false, false]);
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

  function navigateProduct(destination: "signal" | "memory" | "evidence" | "reports") {
    if (destination === "signal") {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    if (scanState !== "matched") {
      runScan();
      return;
    }
    if (destination === "memory") scrollToDetails("history");
    if (destination === "evidence") setPanel("evidence");
    if (destination === "reports") setPanel("brief");
  }

  function openAsteria() {
    clearTimers();
    setScanStep(3);
    setScanState("matched");
    setPanel(null);
    window.setTimeout(() => document.querySelector(".match-card")?.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
  }

  const metricValue = scanState === "matched" ? "1" : scanState === "scanning" ? "—" : "0";

  return (
    <div className="app-shell">
      <aside className="rail" aria-label="Primary navigation">
        <button className="brand-mark" aria-label="Second Look home" onClick={replay}>
          <span><b>SL</b></span>
        </button>
        <nav className="rail-nav" aria-label="Product areas">
          <button className="rail-item active" aria-label="Signal room" data-label="Signal room" onClick={() => navigateProduct("signal")}>01</button>
          <button className="rail-item" aria-label="Deal memory" data-label="Deal memory" onClick={() => navigateProduct("memory")}>02</button>
          <button className="rail-item" aria-label="Market evidence" data-label="Evidence" onClick={() => navigateProduct("evidence")}>03</button>
          <button className="rail-item" aria-label="Reports" data-label="IC briefs" onClick={() => navigateProduct("reports")}>04</button>
        </nav>
        <div className="rail-footer">
          <span className="system-dot" aria-label="All systems ready" />
          <span className="avatar">KM</span>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <button className="wordmark" onClick={replay} aria-label="Return to ready state">
            Second <em>Look</em>
          </button>
          <span className="room-label">SIGNAL ROOM / LIVE</span>
          <span className="demo-label">SYNTHETIC DEMO DATA</span>
          <div className="top-actions">
            <button className="memory-search" onClick={() => setPanel("search")} aria-label="Search deal memory">
              <span>⌕</span> Search deal memory <kbd>⌘ K</kbd>
            </button>
            <span className="index-status">
              {scanState === "scanning" ? "MARKET INDEX · PROCESSING" : scanState === "matched" ? "MARKET INDEX · UPDATED NOW" : "MARKET INDEX · READY"}
            </span>
            {scanState === "matched" && (
              <button className="replay-button" onClick={replay}>Replay</button>
            )}
            <button className={`scan-button ${scanState === "scanning" ? "scanning" : ""}`} onClick={runScan} disabled={scanState === "scanning"}>
              <span className="button-dot" />
              {scanState === "scanning" ? "Scanning…" : scanState === "matched" ? "Run again" : "Run market scan"}
            </button>
          </div>
        </header>

        <main>
          <section className="intro" aria-labelledby="hero-title">
            <div>
              <p className="eyebrow">VC DEAL INTELLIGENCE</p>
              <h1 id="hero-title">The market changed.<br />Your old decisions should, too.</h1>
              <p className="subline">Second Look connects live market shifts to the exact assumptions behind your past investment decisions—before the opportunity moves on.</p>
            </div>
            <div className="metrics" aria-label="Deal intelligence metrics">
              <div className="metric">
                <span className="metric-value">12</span>
                <span className="metric-name">Deals monitored</span>
              </div>
              <div className="metric">
                <span className={`metric-value signal ${scanState === "scanning" ? "searching" : ""}`}>{metricValue}</span>
                <span className="metric-name">Revisit conditions triggered</span>
              </div>
            </div>
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
                <p className="drawer-lede">Second Look found a direct semantic match between the condition recorded by your deal team and a new regulatory signal.</p>
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
                <h2 id="drawer-title">Asteria Bio deserves a second look.</h2>
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
