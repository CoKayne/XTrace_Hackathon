import { getIntelligenceRepository } from "../../../../db/repositories/intelligence";
import { errorResponse, jsonError, jsonOk } from "../../../../lib/api/response";
import { rateLimitRequest, requirePermission } from "../../../../lib/api/safety";
import { resolveRequestContext } from "../../../../lib/auth/request-context";

export const dynamic = "force-dynamic";

// Demo choreography: the RESET DEMO control wipes prior scan products
// (reports, analyses, finished runs, market events) so the next scan is a
// clean-slate reveal. The corpus, XTrace lineage, and stored judgments are
// untouched, and queued or running scans survive. Reset is always an
// explicit human action; page loads never trigger it.
export async function POST(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    requirePermission(context, "mutateSources");
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
    await getIntelligenceRepository().resetScanProducts(context.workspaceId);
    return jsonOk({ reset: true });
  } catch (error) {
    return errorResponse(error);
  }
}
