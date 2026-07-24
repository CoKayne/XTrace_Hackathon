import { z } from "zod";

import { errorResponse, jsonError, jsonOk } from "../../../../lib/api/response";
import { rateLimitRequest } from "../../../../lib/api/safety";
import { createCorpusService } from "../../../../lib/corpus/service";
import { listPreloadedDocuments } from "../../../../lib/corpus/manifest";
import {
  createCorpusPersistence,
  createDefaultDemoDataStore,
  createDefaultPrivateDocumentAccess,
} from "../../../../lib/storage/service";
import { getXTraceClient } from "../../../../lib/xtrace/client";
import { createXTraceService } from "../../../../lib/xtrace/service";

const ConfirmRequestSchema = z.object({
  workspaceId: z.literal("workspace_demo"),
  documentIds: z.array(z.string().min(1)).min(1),
  dealConfirmations: z.array(z.object({
    documentId: z.string().min(1),
    dealId: z.string().min(1),
  })),
});

export async function POST(request: Request) {
  if (
    process.env.NODE_ENV === "production" &&
    (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY)
  ) {
    return jsonError(
      "INTEGRATION_UNAVAILABLE",
      "Private cloud storage and PostgreSQL are required before sources can be confirmed.",
      503,
      true,
    );
  }
  const rate = await rateLimitRequest(request, "confirm-import", 3, 10 * 60_000);
  if (!rate.allowed) {
    return jsonError(
      "RATE_LIMITED",
      `Too many import attempts. Try again in ${rate.retryAfterSeconds} seconds.`,
      429,
      true,
    );
  }
  try {
    const input = ConfirmRequestSchema.parse(await request.json());
    const requiredDocumentIds = listPreloadedDocuments()
      .filter((document) => document.role !== "reference")
      .map((document) => document.id)
      .sort();
    if (
      input.documentIds.length !== requiredDocumentIds.length ||
      input.documentIds.slice().sort().some(
        (documentId, index) => documentId !== requiredDocumentIds[index],
      )
    ) {
      return jsonError(
        "VALIDATION_ERROR",
        "The fixed MVP corpus must be confirmed as one complete set of 13 product inputs.",
        400,
      );
    }
    const corpus = createCorpusService(createCorpusPersistence(
      createDefaultDemoDataStore(),
      createDefaultPrivateDocumentAccess(),
    ));
    const result = await corpus.confirmImport(input);
    const xtraceConfigured = Boolean(process.env.XTRACE_API_KEY && process.env.XTRACE_ORG_ID);
    const xtraceResults = xtraceConfigured
      ? await Promise.allSettled(result.memoryBundles.map((bundle) =>
          createXTraceService(getXTraceClient(), {
            workspaceId: input.workspaceId,
          }).ingestDealMemory(bundle)
        ))
      : [];
    const xtraceJobs = xtraceResults.flatMap((item) =>
      item.status === "fulfilled" ? [item.value] : []
    );
    const xtraceErrors = xtraceResults.flatMap((item) =>
      item.status === "rejected"
        ? [item.reason instanceof Error ? item.reason.message : "XTrace ingestion failed"]
        : []
    );
    return jsonOk({
      ...result,
      xtraceConfigured,
      xtraceJobs,
      xtraceErrors,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
