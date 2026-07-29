import { hostname } from "node:os";

import { getDataClient } from "../db/client";
import { getIntelligenceRepository } from "../db/repositories/intelligence";
import { getReasonerJudgmentsRepository } from "../db/repositories/reasoner-judgments";
import { createRunsRepository } from "../db/repositories/runs";
import { getUploadedDocumentsRepository } from "../db/repositories/uploaded-documents";
import { createDefaultPrivateObjectStorage } from "../lib/storage/service";
import { uploadedDealId } from "../lib/uploads/service";
import {
  buildUploadedDealBundle,
  extractDealProfile,
  extractDocumentText,
  uploadRecallQuery,
} from "./extract-upload";
import { getXTraceLineageRepository } from "../db/repositories/xtrace-lineage";
import { createClaudeClient } from "../lib/claude/client";
import { buildPreloadedDealMemoryBundles } from "../lib/corpus/service";
import { createClaudeMatchingReasoner } from "../lib/matching/claude-reasoner";
import { createProductInputGate } from "../lib/corpus/import-readiness";
import { readMarketProviderConfiguration } from "../lib/market/config";
import { createDefaultMarketProviders } from "../lib/market/providers";
import { createMarketService } from "../lib/market/service";
import {
  getXTraceClient,
  isXTraceConfigured,
} from "../lib/xtrace/client";
import { createXTraceService } from "../lib/xtrace/service";
import { createDefaultDemoDataStore } from "../lib/storage/service";
import {
  workerHealthFilePath,
  writeWorkerHealthMarker,
} from "./health";
import { processClaimedRun } from "./process-run";

const WORKER_ID = process.env.WORKER_ID?.trim()
  || `worker-${hostname()}-${process.pid}`;
const WORKER_HEALTH_FILE = workerHealthFilePath();
const POLL_INTERVAL_MS = 2_000;
const HEARTBEAT_INTERVAL_MS = 15_000;

interface WorkerIterationDependencies {
  runNext?: () => Promise<boolean>;
  sleepImpl?: (milliseconds: number) => Promise<void>;
  onError?: (message: string) => void;
}

export async function runNextQueuedScan(): Promise<boolean> {
  const runs = createRunsRepository(getDataClient());
  await runs.touchWorkerHeartbeat(WORKER_ID);
  await writeWorkerHealthMarker(WORKER_HEALTH_FILE);
  const claimed = await runs.claimNext(WORKER_ID);
  if (!claimed) return false;

  const heartbeat = setInterval(() => {
    void Promise.all([
      runs.touchWorkerHeartbeat(WORKER_ID),
      runs.renewLease(claimed.id, WORKER_ID),
    ]).then(async ([, leaseRenewed]) => {
      if (!leaseRenewed) {
        throw new Error(`Worker no longer owns scan ${claimed.id}`);
      }
      await writeWorkerHealthMarker(WORKER_HEALTH_FILE);
    }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[${WORKER_ID}] heartbeat failed: ${message}`);
    });
  }, HEARTBEAT_INTERVAL_MS);
  heartbeat.unref();

  try {
    const marketConfiguration = readMarketProviderConfiguration();
    const providers = createDefaultMarketProviders(
      marketConfiguration.options,
      marketConfiguration.runtime,
    );
    const intelligence = getIntelligenceRepository();
    const lineage = getXTraceLineageRepository();
    const xtraceService = isXTraceConfigured()
      ? createXTraceService(getXTraceClient(), {
          workspaceId: claimed.workspaceId,
          lineageRepository: lineage,
        })
      : undefined;
    const xtrace = xtraceService
      ? {
          listOpenIngestJobs: (workspaceId: string) =>
            lineage.listOpenJobs(workspaceId),
          pollIngestJob: (
            jobId: string,
            options: { dealId: string },
          ) => xtraceService.pollIngestJob(jobId, options),
          recallDealContext: (
            input: Parameters<typeof xtraceService.recallDealContext>[0],
          ) => xtraceService.recallDealContext(input),
        }
      : undefined;
    await processClaimedRun(claimed, {
      runs,
      intelligence,
      bundles: buildPreloadedDealMemoryBundles(),
      importGate: createProductInputGate(createDefaultDemoDataStore()),
      market: createMarketService({ providers }),
      reasoner: createClaudeMatchingReasoner(createClaudeClient(), {
        judgments: getReasonerJudgmentsRepository(),
        refreshJudgments: process.env.REASONER_JUDGMENT_REFRESH === "1",
      }),
      xtrace,
    });
  } catch (error) {
    const current = await runs.get(claimed.id);
    if (current?.status === "running" && current.workerId === WORKER_ID) {
      await runs.finish({
        runId: claimed.id,
        status: "failed",
        workerId: WORKER_ID,
      });
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[${WORKER_ID}] scan ${claimed.id} failed: ${message}`);
  } finally {
    clearInterval(heartbeat);
    try {
      await runs.touchWorkerHeartbeat(WORKER_ID);
      await writeWorkerHealthMarker(WORKER_HEALTH_FILE);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[${WORKER_ID}] final heartbeat failed: ${message}`);
    }
  }
  return true;
}

// Uploaded documents are extracted, ingested into XTrace, and recalled here.
// They never join the fixed corpus or the 19-Deal scan universe: this is a
// separate memory-building path that only feeds the Deals view.
export async function runNextQueuedUpload(): Promise<boolean> {
  if (!isXTraceConfigured()) return false;
  const uploads = getUploadedDocumentsRepository();
  const claimed = await uploads.claimNext(WORKER_ID);
  if (!claimed) return false;

  try {
    const bytes = await createDefaultPrivateObjectStorage()
      .readPrivateObject(claimed.objectKey);
    if (!bytes) throw new Error("The uploaded file is no longer readable.");

    const claude = createClaudeClient();
    const documentText = await extractDocumentText({
      bytes,
      contentType: claimed.contentType,
      filename: claimed.filename,
      client: claude,
    });
    const profile = await extractDealProfile({
      client: claude,
      documentText,
      filename: claimed.filename,
    });
    const dealId = uploadedDealId(claimed.checksum);
    const bundle = buildUploadedDealBundle({
      record: claimed,
      dealId,
      companyName: profile.companyName,
      headline: profile.headline,
      facts: profile.facts,
    });

    // XTrace lineage rows reference deals(id), so the uploaded Deal needs its
    // own company and deal rows. The Deals page and the scan universe both
    // read the fixed manifest, so these rows never widen either one.
    const dataStore = createDefaultDemoDataStore();
    const companyId = `company_${dealId}`;
    await dataStore.ensureCompany({
      id: companyId,
      workspaceId: claimed.workspaceId,
      name: profile.companyName,
    });
    await dataStore.ensureDeal({
      id: dealId,
      workspaceId: claimed.workspaceId,
      companyId,
      companyName: profile.companyName,
    });

    const xtrace = createXTraceService(getXTraceClient(), {
      workspaceId: claimed.workspaceId,
      lineageRepository: getXTraceLineageRepository(),
    });
    const submitted = await xtrace.ingestDealMemory(bundle);
    const settled = submitted.status === "succeeded" || submitted.status === "failed"
      ? submitted
      : await xtrace.pollIngestJob(submitted.jobId, { dealId });
    if (settled.status !== "succeeded") {
      throw new Error("XTrace could not store this document's memory.");
    }

    const contexts = await xtrace.recallDealContext({
      workspaceId: claimed.workspaceId,
      runId: `upload:${claimed.id}`,
      query: uploadRecallQuery(profile),
      candidateDealIds: [dealId],
      limit: 20,
    });

    await uploads.complete({
      id: claimed.id,
      companyName: profile.companyName,
      headline: profile.headline,
      extractedFacts: profile.facts,
      memoryTexts: contexts.map((context) => context.text),
      memoryIds: settled.memoryIds,
      xtraceJobId: settled.jobId,
      dealId,
    });
    console.log(
      `[${WORKER_ID}] extracted upload ${claimed.id} into ${settled.memoryIds.length} XTrace memories`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await uploads.fail(claimed.id, message);
    console.error(`[${WORKER_ID}] upload ${claimed.id} failed: ${message}`);
  }
  return true;
}

export async function runWorkerIteration(
  dependencies: WorkerIterationDependencies = {},
): Promise<void> {
  const runNext = dependencies.runNext
    ?? (async () => (await runNextQueuedUpload()) || runNextQueuedScan());
  const sleepImpl = dependencies.sleepImpl ?? sleep;
  try {
    const handled = await runNext();
    if (!handled) await sleepImpl(POLL_INTERVAL_MS);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const onError = dependencies.onError
      ?? ((detail: string) =>
        console.error(`[${WORKER_ID}] worker loop failed: ${detail}`));
    onError(message);
    await sleepImpl(POLL_INTERVAL_MS);
  }
}

async function main(): Promise<void> {
  console.log(`[${WORKER_ID}] VSee scan worker started`);
  for (;;) {
    await runWorkerIteration();
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
