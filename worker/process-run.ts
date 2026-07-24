import type { RunRecord } from "../db/client";
import type {
  IntelligenceReportRecord,
  IntelligenceRepository,
} from "../db/repositories/intelligence";
import type { createRunsRepository } from "../db/repositories/runs";
import type { DealMemoryBundle } from "../lib/contracts/domain";
import type { ProductInputGate } from "../lib/corpus/import-readiness";
import { DEMO_MARKET_REPORT_EVIDENCE } from "../lib/corpus/market-evidence";
import {
  buildMatchingSources,
  buildStructuredMemoryContexts,
} from "../lib/matching/context";
import type { MatchingReasoner } from "../lib/matching/service";
import { createMatchingService } from "../lib/matching/service";
import {
  selectMarketEventsForAnalysis,
  type MarketEventSelection,
} from "../lib/market/selection";
import type { MarketService } from "../lib/market/service";
import type { MemoryContext } from "../lib/xtrace/service";
import type { PersistedIngest } from "../lib/xtrace/service";

type RunsRepository = ReturnType<typeof createRunsRepository>;

export interface ProcessRunDependencies {
  runs: RunsRepository;
  intelligence: IntelligenceRepository;
  bundles: DealMemoryBundle[];
  importGate: ProductInputGate;
  market: Pick<MarketService, "scanMarketWindow">;
  reasoner: MatchingReasoner;
  xtrace?: {
    listOpenIngestJobs(workspaceId: string): Promise<Array<{
      jobId: string;
      dealId: string;
    }>>;
    pollIngestJob(jobId: string, options: {
      dealId: string;
    }): Promise<PersistedIngest>;
    recallDealContext(input: {
      workspaceId: string;
      runId?: string;
      query: string;
      candidateDealIds: string[];
      limit: number;
    }): Promise<MemoryContext[]>;
  };
  now?: () => Date;
}

export async function processClaimedRun(
  claimedRun: RunRecord,
  dependencies: ProcessRunDependencies,
): Promise<{ run: RunRecord; report: IntelligenceReportRecord }> {
  const now = dependencies.now ?? (() => new Date());
  const warnings: string[] = [];
  const workerId = claimedRun.workerId;
  if (!workerId) throw new Error(`Run ${claimedRun.id} has no owning worker`);
  let activeStage = claimedRun.currentStage ?? "worker_setup";
  let activeStageStatus:
    | "running"
    | "skipped"
    | "completed"
    | "failed"
    | undefined;
  const updateStage = async (
    name: string,
    status: "running" | "skipped" | "completed" | "failed",
    warning?: string,
  ) => {
    activeStage = name;
    activeStageStatus = status;
    return stage(
      dependencies.runs,
      claimedRun.id,
      workerId,
      name,
      status,
      warning,
    );
  };

  try {
    await updateStage("import_confirmation", "running");
    try {
      await dependencies.importGate.assertReady(claimedRun.workspaceId);
      await updateStage("import_confirmation", "completed");
    } catch (error) {
      const warning = error instanceof Error
        ? error.message
        : "The fixed MVP corpus is not confirmed.";
      await updateStage("import_confirmation", "failed", warning);
      throw error;
    }

    await updateStage("market_scan", "running");
    const market = await dependencies.market.scanMarketWindow({
      days: 14,
      now: now(),
    });
    await dependencies.intelligence.saveMarketEvents(
      market.events,
      claimedRun.workspaceId,
    );
    const marketSelection = selectMarketEventsForAnalysis(market.events);
    const analysisEvents = marketSelection.events;
    const marketWarnings: string[] = [];
    const marketNotices: string[] = [];
    if (market.status !== "completed") {
      const warning = market.status === "failed"
        ? "All configured market providers failed; the report contains no fresh market evidence."
        : "Some market providers failed; the report is based on the successful sources only.";
      marketWarnings.push(warning);
    }
    if (marketSelection.ineligibleCount > 0) {
      marketNotices.push(
        `${marketSelection.ineligibleCount} public source ${
          marketSelection.ineligibleCount === 1 ? "item did" : "items did"
        } not contain a bounded funding, technology, regulatory, commercial, or macroeconomic signal and ${
          marketSelection.ineligibleCount === 1 ? "was" : "were"
        } excluded from downstream analysis.`,
      );
    }
    const lowerRankedCount =
      marketSelection.eligibleCount - marketSelection.events.length;
    if (lowerRankedCount > 0) {
      marketWarnings.push(
        `${lowerRankedCount} lower-ranked market ${
          lowerRankedCount === 1 ? "event was" : "events were"
        } excluded from XTrace recall and opportunity analysis to keep model inputs bounded.`,
      );
    }
    warnings.push(...marketWarnings);
    await updateStage(
      "market_scan",
      "completed",
      marketWarnings.length || marketNotices.length
        ? [...marketWarnings, ...marketNotices].join(" ")
        : undefined,
    );

    const allDeals = dependencies.bundles.map((bundle) => ({
      id: bundle.dealId,
      companyName: bundle.companyName,
      status: bundle.status,
    }));
    let matchingBundles = claimedRun.mode === "xtrace" ? [] : dependencies.bundles;
    let deals = claimedRun.mode === "xtrace" ? [] : allDeals;
    let memoryContexts = claimedRun.mode === "xtrace"
      ? []
      : buildStructuredMemoryContexts(dependencies.bundles);
    if (claimedRun.mode === "xtrace" && analysisEvents.length > 0) {
      await updateStage("memory_ingest_sync", "running");
      if (dependencies.xtrace) {
        let failedJobs = 0;
        try {
          const openJobs = await dependencies.xtrace.listOpenIngestJobs(
            claimedRun.workspaceId,
          );
          for (const job of openJobs) {
            try {
              const completed = await dependencies.xtrace.pollIngestJob(
                job.jobId,
                { dealId: job.dealId },
              );
              if (completed.status === "failed") failedJobs += 1;
            } catch {
              failedJobs += 1;
            }
          }
        } catch {
          const warning = "Pending XTrace ingest jobs could not be inspected before recall.";
          warnings.push(warning);
          await updateStage(
            "memory_ingest_sync",
            "failed",
            warning,
          );
          failedJobs = -1;
        }
        if (failedJobs > 0) {
          const warning = `${failedJobs} pending XTrace ingest ${failedJobs === 1 ? "job" : "jobs"} did not complete before recall.`;
          warnings.push(warning);
          await updateStage(
            "memory_ingest_sync",
            "completed",
            warning,
          );
        } else if (failedJobs === 0) {
          await updateStage(
            "memory_ingest_sync",
            "completed",
          );
        }
      } else {
        await updateStage(
          "memory_ingest_sync",
          "skipped",
        );
      }

      await updateStage("memory_recall", "running");
      try {
        if (!dependencies.xtrace) {
          throw new Error("XTrace is not configured");
        }
        const recalled = await dependencies.xtrace.recallDealContext({
          workspaceId: claimedRun.workspaceId,
          runId: claimedRun.id,
          query: analysisEvents
            .map((event) => `${event.title}. ${event.summary}`)
            .join("\n"),
          candidateDealIds: allDeals.map((deal) => deal.id),
          limit: 100,
        });
        if (recalled.length > 0) {
          const recalledDealIds = new Set(recalled.map((memory) => memory.dealId));
          matchingBundles = dependencies.bundles.filter((bundle) =>
            recalledDealIds.has(bundle.dealId)
          );
          deals = matchingBundles.map((bundle) => ({
            id: bundle.dealId,
            companyName: bundle.companyName,
            status: bundle.status,
          }));
          memoryContexts = recalled.map((memory) => ({
            dealId: memory.dealId,
            text: memory.text,
            sourceIds: memory.sourceIds,
            fixtureIds: memory.fixtureIds,
          }));
          await updateStage("memory_recall", "completed");
        } else {
          const warning = "XTrace returned no eligible memories; no historical Deal candidates were sent to matching.";
          warnings.push(warning);
          await updateStage("memory_recall", "completed", warning);
        }
      } catch {
        const warning = "XTrace recall was unavailable; no historical Deal candidates were sent to matching.";
        warnings.push(warning);
        await updateStage("memory_recall", "failed", warning);
      }
    } else {
      await updateStage("memory_ingest_sync", "skipped");
      await updateStage("memory_recall", "skipped");
    }

    await updateStage("opportunity_matching", "running");
    const sources = buildMatchingSources(
      matchingBundles,
      analysisEvents,
      DEMO_MARKET_REPORT_EVIDENCE.map((evidence) => evidence.source),
    );
    const opportunities = await createMatchingService(dependencies.reasoner).match({
      deals,
      events: analysisEvents,
      memoryContexts,
      sources,
    });
    await updateStage("opportunity_matching", "completed");

    await updateStage("report", "running");
    const report: IntelligenceReportRecord = {
      id: `report_${claimedRun.id}`,
      workspaceId: claimedRun.workspaceId,
      runId: claimedRun.id,
      createdAt: now().toISOString(),
      marketSummary: buildMarketSummary(market, marketSelection),
      opportunities,
    };
    const storedReport = await dependencies.intelligence.saveReport(report);
    await updateStage("report", "completed");
    await updateStage("notification", "skipped");

    const finalRun = await dependencies.runs.finish({
      runId: claimedRun.id,
      status: warnings.length ? "partial" : "completed",
      workerId,
    });
    return { run: finalRun, report: storedReport };
  } catch (error) {
    if (activeStageStatus !== "failed") {
      const detail = (error instanceof Error ? error.message : String(error))
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 800) || "Unknown scan error";
      try {
        await updateStage(
          activeStage,
          "failed",
          `${activeStage} failed: ${detail}`,
        );
      } catch {
        // Preserve the original stage failure even if diagnostics cannot be written.
      }
    }
    await dependencies.runs.finish({
      runId: claimedRun.id,
      status: "failed",
      workerId,
    });
    throw error;
  }
}

function buildMarketSummary(
  market: Awaited<ReturnType<MarketService["scanMarketWindow"]>>,
  selection: MarketEventSelection,
): string {
  const successful = market.providers.filter((provider) => !provider.error);
  if (!market.events.length) {
    return [
      `No source-backed market events were accepted in the ${market.window.days}-day window.`,
      `${successful.length} of ${market.providers.length} configured providers completed successfully.`,
      "This is an evidence-availability result, not a claim that the market was unchanged.",
    ].join(" ");
  }
  const themes = selection.events.flatMap((event) => event.themes)
    .filter(Boolean)
    .reduce<Map<string, number>>((counts, theme) => {
      counts.set(theme, (counts.get(theme) ?? 0) + 1);
      return counts;
    }, new Map());
  const leadingThemes = [...themes.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .map(([theme, count]) => `${theme} (${count})`);
  return [
    `The ${market.window.days}-day scan accepted ${market.events.length} source-backed market ${market.events.length === 1 ? "event" : "events"} from ${successful.length} successful ${successful.length === 1 ? "provider" : "providers"}.`,
    `Analysis selected ${selection.events.length} of ${selection.totalCount} source-backed items. ${
      selection.ineligibleCount > 0
        ? `${selection.ineligibleCount} ${
          selection.ineligibleCount === 1 ? "item lacked" : "items lacked"
        } a bounded market-change signal.`
        : "Every accepted item contained a bounded market-change signal."
    } ${
      selection.eligibleCount > selection.events.length
        ? `${selection.eligibleCount - selection.events.length} lower-ranked eligible ${
          selection.eligibleCount - selection.events.length === 1
            ? "event was"
            : "events were"
        } excluded to keep XTrace and model inputs bounded.`
        : ""
    }`.trim(),
    leadingThemes.length
      ? `Most frequent normalized themes in the selected evidence: ${leadingThemes.join(", ")}.`
      : "The accepted sources did not provide enough normalized theme labels for a theme ranking.",
    "Review the cited sources before acting.",
  ].join(" ");
}

async function stage(
  runs: RunsRepository,
  runId: string,
  workerId: string,
  name: string,
  status: "running" | "skipped" | "completed" | "failed",
  warning?: string,
): Promise<void> {
  await runs.updateStage({
    runId,
    workerId,
    stage: name,
    status,
    warning,
  });
}
