import { z } from "zod";

import { errorResponse, jsonOk } from "../../../../lib/api/response";
import {
  resolveRouteRequestContext,
  type RouteDependencies,
} from "../../../../lib/api/route-dependencies";
import { requirePermission } from "../../../../lib/api/safety";
import { previewImport } from "../../../../lib/corpus/service";

const PreviewRequestSchema = z.object({
  documentIds: z.array(z.string().min(1)).min(1),
});

export async function POST(
  request: Request,
  _routeContext?: unknown,
  dependencies: RouteDependencies = {},
) {
  try {
    const context = await resolveRouteRequestContext(request, dependencies);
    requirePermission(context, "readWorkspace");
    const { documentIds } = PreviewRequestSchema.parse(await request.json());
    return jsonOk(previewImport(documentIds));
  } catch (error) {
    return errorResponse(error);
  }
}
