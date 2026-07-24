import type { RunStatus } from "../../lib/contracts/domain";
import type { DataClient, RunMode } from "../client";

export function createRunsRepository(client: DataClient) {
  return {
    async create(input: {
      workspaceId: string;
      mode: RunMode;
      windowDays: 14;
    }) {
      const active = await client.findActiveRun(input);
      return active ?? client.insertRun(input);
    },
    claimNext(workerId: string) {
      return client.claimNextRun(workerId);
    },
    get(runId: string) {
      return client.getRun(runId);
    },
    list(workspaceId: string) {
      return client.listRuns(workspaceId);
    },
    async updateStage(input: {
      runId: string;
      stage: string;
      status: "queued" | "running" | "skipped" | "completed" | "failed";
      warning?: string;
    }) {
      const run = await client.getRun(input.runId);
      if (!run) throw new Error(`Run ${input.runId} was not found`);
      const warnings = input.warning ? [...run.warnings, input.warning] : run.warnings;
      await client.insertRunStage({
        runId: input.runId,
        stage: input.stage,
        status: input.status,
        warning: input.warning ?? null,
        startedAt: new Date().toISOString(),
        completedAt: input.status === "running" ? null : new Date().toISOString(),
      });
      return client.updateRun(input.runId, {
        currentStage: input.stage,
        warningCount: warnings.length,
        warnings,
      });
    },
    async finish(input: { runId: string; status: Extract<RunStatus, "partial" | "completed" | "failed"> }) {
      return client.updateRun(input.runId, {
        status: input.status,
        completedAt: new Date().toISOString(),
      });
    },
  };
}

