"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";

type ScanState = "idle" | "scanning" | "matched";
type Panel = "evidence" | "brief" | null;

const scanCopy = [
  "Indexing verified market signals",
  "Comparing against 486 decision memories",
  "Testing 12 revisit conditions",
];

export default function Home() {
  const [scanState, setScanState] = useState<ScanState>("idle");
  const [scanStep, setScanStep] = useState(0);
  const [panel, setPanel] = useState<Panel>(null);
  const [toast, setToast] = useState("");
  const timers = useRef<number[]>([]);

  const clearTimers = () => {
    timers.current.forEach((timer) => window.clearTimeout(timer));
    timers.current = [];
  };

  useEffect(() => clearTimers, []);

  useEffect(() => {
    if (!panel) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPanel(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [panel]);

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

  const metricValue = scanState === "matched" ? "1" : scanState === "scanning" ? "—" : "0";

  return (
    <div className="app-shell">
      <aside className="rail" aria-label="Primary navigation">
        <button className="brand-mark" aria-label="Second Look home" onClick={replay}>
          <span><b>SL</b></span>
        </button>
        <nav className="rail-nav" aria-label="Product areas">
          <button className="rail-item active" aria-label="Signal room" data-label="Signal room">01</button>
          <button className="rail-item" aria-label="Deal memory" data-label="Deal memory">02</button>
          <button className="rail-item" aria-label="Market evidence" data-label="Evidence">03</button>
          <button className="rail-item" aria-label="Reports" data-label="Reports">04</button>
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
        </main>
      </div>

      {panel && (
        <div className="overlay" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setPanel(null);
        }}>
          <section className={`drawer ${panel}`} role="dialog" aria-modal="true" aria-labelledby="drawer-title">
            <button className="drawer-close" onClick={() => setPanel(null)} aria-label="Close panel">×</button>
            {panel === "evidence" ? (
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
                    <p><strong>Recommended action</strong><br />Schedule a 30-minute re-evaluation with the original deal team this week.</p>
                  </div>
                  <div className="attachment-row"><span>2</span> evidence links attached</div>
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
