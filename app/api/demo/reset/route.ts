import { getDataClient } from "../../../../db/client";
import {
  ActiveScanResetError,
  getTestGenerationRepository,
} from "../../../../db/repositories/test-generations";
import { errorResponse, jsonError, jsonOk } from "../../../../lib/api/response";
import {
  resolveRouteRequestContext,
  type RouteDependencies,
} from "../../../../lib/api/route-dependencies";
import { rateLimitRequest, requirePermission } from "../../../../lib/api/safety";

export const dynamic = "force-dynamic";

const ACTIVE_SCAN_RESET_MESSAGE =
  "The current test view cannot be reset while a scan is active.";

export async function POST(
  request: Request,
  _routeContext?: unknown,
  dependencies: RouteDependencies = {},
) {
  try {
    const context = await resolveRouteRequestContext(request, dependencies);
    requirePermission(context, "mutateSources");
    if (context.mode !== "public_sandbox") throw new Error("FORBIDDEN");
    const rate = await rateLimitRequest(
      request,
      "demo-reset",
      60,
      10 * 60_000,
      { context },
    );
    if (!rate.allowed) {
      return jsonError(
        "RATE_LIMITED",
        `Too many resets. Try again in ${rate.retryAfterSeconds} seconds.`,
        429,
        true,
      );
    }
    const activeRun = (await getDataClient().listRuns(context.workspaceId)).some(
      ({ status }) => status === "queued" || status === "running",
    );
    if (activeRun) {
      return jsonError("CONFLICT", ACTIVE_SCAN_RESET_MESSAGE, 409);
    }
    const { resetAt } = await getTestGenerationRepository().advance({
      workspaceId: context.workspaceId,
      actorId: context.principal!.userId,
    });
    return jsonOk({ reset: true, resetAt });
  } catch (error) {
    if (error instanceof ActiveScanResetError) {
      return jsonError("CONFLICT", ACTIVE_SCAN_RESET_MESSAGE, 409);
    }
    return errorResponse(error);
  }
}
