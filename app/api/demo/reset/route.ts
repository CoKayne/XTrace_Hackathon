import { getIntelligenceRepository } from "../../../../db/repositories/intelligence";
import { errorResponse, jsonError, jsonOk } from "../../../../lib/api/response";
import { rateLimitRequest } from "../../../../lib/api/safety";

const WORKSPACE_ID = "workspace_demo";

export const dynamic = "force-dynamic";

// Demo choreography: the page must not know any scan outcome before the
// viewer runs a scan, so every page load wipes prior scan products (reports,
// analyses, finished runs, market events). The corpus, XTrace lineage, and
// stored judgments are untouched, and queued or running scans survive.
export async function POST(request: Request) {
  const rate = await rateLimitRequest(request, "demo-reset", 60, 10 * 60_000);
  if (!rate.allowed) {
    return jsonError(
      "RATE_LIMITED",
      `Too many resets. Try again in ${rate.retryAfterSeconds} seconds.`,
      429,
      true,
    );
  }
  try {
    await getIntelligenceRepository().resetScanProducts(WORKSPACE_ID);
    return jsonOk({ reset: true });
  } catch (error) {
    return errorResponse(error);
  }
}
