import { z } from "zod";

import { getUnderwritingArtifactsRepository } from "../../../db/repositories/underwriting-artifacts";
import { errorResponse, jsonOk } from "../../../lib/api/response";
import {
  resolveRouteRequestContext,
  type RouteDependencies,
} from "../../../lib/api/route-dependencies";
import { requirePermission } from "../../../lib/api/safety";
import {
  searchPersistedUnderwriting,
} from "../../../lib/underwriting/read-model";

const SearchQuerySchema = z.string().trim().min(2).max(500);

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  _routeContext?: unknown,
  dependencies: RouteDependencies = {},
) {
  try {
    const context = await resolveRouteRequestContext(request, dependencies);
    requirePermission(context, "readWorkspace");
    if (context.mode !== "product") throw new Error("FORBIDDEN");
    const query = SearchQuerySchema.parse(
      new URL(request.url).searchParams.get("q") ?? "",
    );
    const results = await searchPersistedUnderwriting({
      workspaceId: context.workspaceId,
      query,
      artifacts: dependencies.underwritingArtifacts
        ?? getUnderwritingArtifactsRepository(),
    });
    return jsonOk({ query, results });
  } catch (error) {
    return errorResponse(error);
  }
}
