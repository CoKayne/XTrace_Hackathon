"use client";

export interface ScanProgressRun {
  id: string;
  status: "queued" | "running" | "partial" | "completed" | "failed";
  currentStage: string | null;
  warningCount: number;
  warnings: string[];
}

interface ScanProgressProps {
  run: ScanProgressRun;
  onClose(): void;
}

const stages = [
  {
    key: "market_scan",
    label: "Scanning the last 14 days of public evidence",
  },
  {
    key: "normalize",
    label: "Normalizing and ranking market events",
  },
  {
    key: "memory_recall",
    label: "Recalling XTrace investment memory",
  },
  {
    key: "opportunity_matching",
    label: "Comparing evidence across eligible companies",
  },
  {
    key: "report",
    label: "Generating company intelligence report",
  },
] as const;

function stageIndex(run: ScanProgressRun): number {
  if (run.status === "completed" || run.status === "partial") {
    return stages.length;
  }
  switch (run.currentStage) {
    case "market_scan":
      return 0;
    case "memory_ingest_sync":
    case "memory_recall":
      return 2;
    case "opportunity_matching":
      return 3;
    case "report":
    case "notification":
      return 4;
    default:
      return -1;
  }
}

export function ScanProgress({ run, onClose }: ScanProgressProps) {
  const currentIndex = stageIndex(run);
  const terminal = run.status === "completed"
    || run.status === "partial"
    || run.status === "failed";
  const failed = run.status === "failed";

  return (
    <section
      className="vsee-scan-progress"
      role="dialog"
      aria-modal="true"
      aria-labelledby="scan-progress-title"
      aria-describedby="scan-progress-copy"
    >
      <div className="vsee-scan-progress-card">
        <header>
          <div>
            <span className="vsee-eyebrow">DURABLE MARKET SCAN</span>
            <h2 id="scan-progress-title">
              {failed
                ? "The scan could not produce a report"
                : terminal
                ? "Report ready"
                : "The agent is connecting market change to Deal memory."}
            </h2>
            <p id="scan-progress-copy">
              Progress is saved by the background worker. You may close this
              window or navigate elsewhere without interrupting the scan.
            </p>
          </div>
          <button onClick={onClose} aria-label="Close scan progress">×</button>
        </header>

        <ol aria-label="Scan stages">
          {stages.map((stage, index) => {
            const state = failed && index === Math.max(currentIndex, 0)
              ? "failed"
              : index < currentIndex || terminal && !failed
              ? "complete"
              : index === currentIndex
              ? "active"
              : "pending";
            return (
              <li className={state} key={stage.key}>
                <span>{state === "complete" ? "✓" : String(index + 1).padStart(2, "0")}</span>
                <div>
                  <strong>{stage.label}</strong>
                  <small>
                    {state === "complete"
                      ? "Complete"
                      : state === "active"
                      ? "In progress"
                      : state === "failed"
                      ? "Stopped here"
                      : "Pending"}
                  </small>
                </div>
              </li>
            );
          })}
        </ol>

        {!!run.warnings.length && (
          <div className="vsee-scan-warnings" role="status">
            <strong>{run.warningCount} scan warning{run.warningCount === 1 ? "" : "s"}</strong>
            {run.warnings.map((warning, index) => (
              <p key={`${run.id}-progress-warning-${index}`}>{warning}</p>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
