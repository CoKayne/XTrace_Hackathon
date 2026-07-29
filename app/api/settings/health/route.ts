import { getDataClient } from "../../../../db/client";
import { createRunsRepository } from "../../../../db/repositories/runs";
import { errorResponse, jsonOk } from "../../../../lib/api/response";
import { requirePermission } from "../../../../lib/api/safety";
import { resolveRequestContext } from "../../../../lib/auth/request-context";
import { getProductInputReadiness } from "../../../../lib/corpus/import-readiness";
import { readMarketProviderConfiguration } from "../../../../lib/market/config";
import { createDefaultDemoDataStore } from "../../../../lib/storage/service";
import { isXTraceConfigured } from "../../../../lib/xtrace/client";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    requirePermission(context, "readWorkspace");
    const market = readMarketProviderConfiguration();
    const corpus = await getProductInputReadiness(
      createDefaultDemoDataStore(),
      context.workspaceId,
    );
    const postgres = Boolean(
      process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    let worker = false;
    if (postgres) {
      try {
        worker = await createRunsRepository(getDataClient()).isWorkerHealthy();
      } catch {
        worker = false;
      }
    }

    return jsonOk({
      postgres,
      worker,
      xtrace: isXTraceConfigured(),
      anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
      storage: Boolean(
        postgres &&
        process.env.SUPABASE_STORAGE_BUCKET &&
        process.env.DOCUMENT_URL_SIGNING_SECRET &&
        process.env.DOCUMENT_URL_SIGNING_SECRET.length >= 32
      ),
      corpusReady: corpus.ready,
      corpusConfirmedCount: corpus.confirmedCount,
      corpusRequiredCount: corpus.requiredCount,
      marketProviders: market.configuredProviderCount,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
