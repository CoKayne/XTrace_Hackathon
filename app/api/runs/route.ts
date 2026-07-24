import { CreateRunRequestSchema } from "../../../lib/contracts/http";
import { createRunsRepository } from "../../../db/repositories/runs";
import { getDataClient } from "../../../db/client";
import {
  errorResponse,
  jsonCreated,
  jsonError,
  jsonOk,
} from "../../../lib/api/response";
import { rateLimitRequest } from "../../../lib/api/safety";
import { getProductInputReadiness } from "../../../lib/corpus/import-readiness";
import { createDefaultDemoDataStore } from "../../../lib/storage/service";
import { isXTraceConfigured } from "../../../lib/xtrace/client";

const WORKSPACE_ID = "workspace_demo";

export const dynamic = "force-dynamic";

export async function GET() {
  const runs = await createRunsRepository(getDataClient()).list(WORKSPACE_ID);
  return jsonOk(runs);
}

export async function POST(request: Request) {
  if (
    process.env.NODE_ENV === "production" &&
    (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY)
  ) {
    return jsonError(
      "INTEGRATION_UNAVAILABLE",
      "Persistent PostgreSQL is required before a public scan can be queued.",
      503,
      true,
    );
  }
  const rate = await rateLimitRequest(request, "run-scan", 5, 10 * 60_000);
  if (!rate.allowed) {
    return jsonError(
      "RATE_LIMITED",
      `Too many scans. Try again in ${rate.retryAfterSeconds} seconds.`,
      429,
      true,
    );
  }
  try {
    const parsed = CreateRunRequestSchema.parse(await request.json());
    const runs = createRunsRepository(getDataClient());
    let workerReady = false;
    try {
      workerReady = await runs.isWorkerHealthy();
    } catch {
      workerReady = false;
    }
    if (!workerReady) {
      return jsonError(
        "INTEGRATION_UNAVAILABLE",
        "A healthy background worker is required before a market scan can be queued.",
        503,
        true,
      );
    }
    const readiness = await getProductInputReadiness(
      createDefaultDemoDataStore(),
      WORKSPACE_ID,
    );
    if (!readiness.ready) {
      return jsonError(
        "CONFLICT",
        `Confirm the fixed MVP corpus before running a scan: ${readiness.confirmedCount} of ${readiness.requiredCount} product inputs are durable.`,
        409,
      );
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      return jsonError(
        "INTEGRATION_UNAVAILABLE",
        "Anthropic is required before a market scan can be queued.",
        503,
        true,
      );
    }
    if (parsed.xtraceEnabled && !isXTraceConfigured()) {
      return jsonError(
        "INTEGRATION_UNAVAILABLE",
        "XTrace is required for an XTrace-mode scan.",
        503,
        true,
      );
    }
    const run = await runs.create({
      workspaceId: WORKSPACE_ID,
      mode: parsed.xtraceEnabled ? "xtrace" : "structured",
      windowDays: 14,
    });
    return jsonCreated(run);
  } catch (error) {
    return errorResponse(error);
  }
}
