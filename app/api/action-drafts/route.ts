import { z } from "zod";

import { getUnderwritingArtifactsRepository } from "../../../db/repositories/underwriting-artifacts";
import { errorResponse, jsonOk } from "../../../lib/api/response";
import {
  resolveRouteRequestContext,
  type RouteDependencies,
} from "../../../lib/api/route-dependencies";
import { requirePermission } from "../../../lib/api/safety";
import { toPublicActionDraft } from "../../../lib/underwriting/read-model";
import { isDurableWorkspaceMode } from "../../../lib/auth/request-context";

const CandidateRunIdSchema = z.string().trim().min(1).max(500);

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  _routeContext?: unknown,
  dependencies: RouteDependencies = {},
) {
  try {
    const context = await resolveRouteRequestContext(request, dependencies);
    requirePermission(context, "readWorkspace");
    if (!isDurableWorkspaceMode(context.mode)) throw new Error("FORBIDDEN");
    const candidateRunId = CandidateRunIdSchema.parse(
      new URL(request.url).searchParams.get("candidateRunId") ?? "",
    );
    const drafts = await (
      dependencies.underwritingArtifacts
        ?? getUnderwritingArtifactsRepository()
    ).listActionDrafts({
      workspaceId: context.workspaceId,
      candidateRunId,
    });
    return jsonOk(drafts.map(toPublicActionDraft));
  } catch (error) {
    return errorResponse(error);
  }
}
