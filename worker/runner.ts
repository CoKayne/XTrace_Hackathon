import { hostname } from "node:os";

import { getDataClient } from "../db/client";
import { getIntelligenceRepository } from "../db/repositories/intelligence";
import { getReasonerJudgmentsRepository } from "../db/repositories/reasoner-judgments";
import { getDealRegistry } from "../db/repositories/deal-registry";
import { getEvidencePacksRepository } from "../db/repositories/evidence-packs";
import { getSourceRegistry } from "../db/repositories/source-registry";
import {
  createMemoryUnderwritingRunsRepository,
  createSupabaseUnderwritingRunsRepository,
} from "../db/repositories/underwriting-runs";
import {
  getUnderwritingReferencesRepository,
} from "../db/repositories/underwriting-references";
import { createRunsRepository } from "../db/repositories/runs";
import { getUploadedDocumentsRepository } from "../db/repositories/uploaded-documents";
import { createDefaultPrivateObjectStorage } from "../lib/storage/service";
import {
  extractUploadPreview,
  processClaimedUpload,
} from "./extract-upload";
import { getXTraceLineageRepository } from "../db/repositories/xtrace-lineage";
import { createClaudeClient } from "../lib/claude/client";
import { createClaudeMatchingReasoner } from "../lib/matching/claude-reasoner";
import {
  createFrameworkLensService,
} from "../lib/underwriting/frameworks/service";
import {
  createSourceGroundedCandidateExecutor,
  createUnderwritingOrchestrator,
} from "../lib/underwriting/orchestrator";
import {
  createEvidencePackCandidateGrounding,
} from "../lib/underwriting/candidate-grounding";
import {
  createEvidencePackBuilder,
} from "../lib/underwriting/evidence/builder";
import { createContextRouter } from "../lib/underwriting/router";
import { SLICE_ONE_CONTEXTS } from "../seed/underwriting/slice-one-contexts-v1";
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
      runs.renewLease(claimed.workspaceId, claimed.id, WORKER_ID),
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
    const dealRegistry = getDealRegistry();
    const claude = createClaudeClient();
    const underwritingRuns = createDefaultUnderwritingRunsRepository();
    const references = getUnderwritingReferencesRepository();
    const lineage = getXTraceLineageRepository();
    const evidenceRepository = getEvidencePacksRepository();
    const sourceRegistry = getSourceRegistry();
    const router = createContextRouter();
    const criticalEvidenceProfiles = (
      await Promise.all(
        SLICE_ONE_CONTEXTS.map((context) =>
          references.getCriticalEvidenceProfile(
            context.criticalEvidenceProfileId,
          )
        ),
      )
    ).filter((profile) => profile !== null);
    const grounding = createEvidencePackCandidateGrounding({
      repository: evidenceRepository,
      sourceRegistry,
      builder: createEvidencePackBuilder({
        repository: evidenceRepository,
        sourceRegistry,
        router,
        criticalEvidenceProfiles,
      }),
      xtraceLineage: lineage,
      resolveBenchmark: (context) => context.benchmarkPackId
        ? references.getSelectedBenchmark({
            packId: context.benchmarkPackId,
            stage: context.stage,
            asOfDate: context.asOfDate,
          })
        : Promise.resolve(null),
    });
    const model = process.env.ANTHROPIC_MODEL ?? "claude-opus-4-8";
    const underwriting = createUnderwritingOrchestrator({
      runs: underwritingRuns,
      activeFundPolicy: (workspaceId) =>
        references.activeFundPolicy(workspaceId),
      candidateExecutionFingerprint:
        `source-grounded-v2:${model}:framework-lens-v1:framework-judgment-v1`,
      candidateExecutor: createSourceGroundedCandidateExecutor({
        grounding,
        frameworkLenses: createFrameworkLensService({
          client: claude,
          execution: {
            provider: "anthropic",
            model,
            promptVersion: "framework-lens-v1",
            schemaVersion: "framework-judgment-v1",
            settingsFingerprint: "balanced-underwriting-v1",
            applicationCommit:
              process.env.RAILWAY_GIT_COMMIT_SHA ?? "local-development",
          },
        }),
        execution: {
          providerModel: model,
          promptVersion: "framework-lens-v1",
          schemaVersion: "framework-judgment-v1",
          settingsFingerprint: "balanced-underwriting-v1",
          applicationCommit:
            process.env.RAILWAY_GIT_COMMIT_SHA ?? "local-development",
        },
      }),
    });
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
      dealRegistry,
      underwriting,
      importGate: createProductInputGate(createDefaultDemoDataStore()),
      market: createMarketService({ providers }),
      reasoner: createClaudeMatchingReasoner(claude, {
        judgments: getReasonerJudgmentsRepository(),
        refreshJudgments: process.env.REASONER_JUDGMENT_REFRESH === "1",
      }),
      xtrace,
    });
  } catch (error) {
    const current = await runs.get(claimed.workspaceId, claimed.id);
    if (current?.status === "running" && current.workerId === WORKER_ID) {
      await runs.finish({
        workspaceId: claimed.workspaceId,
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

function createDefaultUnderwritingRunsRepository() {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && serviceRoleKey
    ? createSupabaseUnderwritingRunsRepository({ url, serviceRoleKey })
    : createMemoryUnderwritingRunsRepository();
}

// Uploaded documents are staged here for explicit confirmation. They never
// join the fixed corpus or create a Deal/XTrace record during extraction.
export async function runNextQueuedUpload(): Promise<boolean> {
  const uploads = getUploadedDocumentsRepository();
  const claimed = await uploads.claimNext(WORKER_ID);
  if (!claimed) return false;
  const leaseHeartbeat = setInterval(() => {
    void uploads.renewLease({
      workspaceId: claimed.workspaceId,
      id: claimed.id,
      workerId: claimed.workerId,
    }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[${WORKER_ID}] upload lease renewal failed: ${message}`);
    });
  }, 60_000);
  leaseHeartbeat.unref();

  try {
    const bytes = await createDefaultPrivateObjectStorage()
      .readPrivateObject(claimed.objectKey);
    if (!bytes) throw new Error("The uploaded file is no longer readable.");

    const claude = createClaudeClient();
    await processClaimedUpload(claimed, {
      extract: () => extractUploadPreview({
        record: claimed,
        bytes,
        client: claude,
      }),
      savePreview: (input) => uploads.savePreview(input),
    });
    console.log(
      `[${WORKER_ID}] extracted upload ${claimed.id} for confirmation`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const transitioned = await uploads.fail({
      workspaceId: claimed.workspaceId,
      id: claimed.id,
      workerId: claimed.workerId,
      reason: message,
    });
    if (!transitioned) console.error(`[${WORKER_ID}] upload ${claimed.id} claim was lost before failure transition`);
    console.error(`[${WORKER_ID}] upload ${claimed.id} failed: ${message}`);
  } finally {
    clearInterval(leaseHeartbeat);
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
