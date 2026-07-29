import {
  getUnderwritingReferencesRepository,
} from "../../../../db/repositories/underwriting-references";
import {
  jsonOk,
} from "../../../../lib/api/response";
import {
  resolveRouteRequestContext,
  type RouteDependencies,
} from "../../../../lib/api/route-dependencies";
import { requirePermission } from "../../../../lib/api/safety";
import {
  createUnderwritingReferencesService,
} from "../../../../lib/underwriting/references/service";
import {
  policyErrorResponse,
  requireActorId,
} from "../route";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  _routeContext?: unknown,
  dependencies: RouteDependencies = {},
) {
  try {
    const context = await resolveRouteRequestContext(request, dependencies);
    requirePermission(context, "managePolicy");
    const service = createUnderwritingReferencesService(
      dependencies.underwritingReferences
        ?? getUnderwritingReferencesRepository(),
    );
    return jsonOk(await service.applyRecommended({
      workspaceId: context.workspaceId,
      actorId: requireActorId(context),
      body: await request.json(),
    }));
  } catch (error) {
    return policyErrorResponse(error);
  }
}
