import { createRunsRepository } from "../../../../db/repositories/runs";
import { getDataClient } from "../../../../db/client";
import { errorResponse, jsonError, jsonOk } from "../../../../lib/api/response";
import {
  resolveRouteRequestContext,
  type RouteDependencies,
} from "../../../../lib/api/route-dependencies";
import { requirePermission } from "../../../../lib/api/safety";
import { toPublicRun } from "../../../../lib/runs/public";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
  dependencies: RouteDependencies = {},
) {
  try {
    const requestContext = await resolveRouteRequestContext(
      request,
      dependencies,
    );
    requirePermission(requestContext, "readWorkspace");
    const { id } = await context.params;
    const run = await createRunsRepository(getDataClient()).get(
      requestContext.workspaceId,
      id,
    );
    return run
      ? jsonOk(toPublicRun(run))
      : jsonError("NOT_FOUND", `Run ${id} was not found`, 404);
  } catch (error) {
    return errorResponse(error);
  }
}
