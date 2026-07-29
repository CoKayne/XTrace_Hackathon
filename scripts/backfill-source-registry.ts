import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  getDealRegistry,
  type DealRegistry,
} from "../db/repositories/deal-registry";
import {
  getSourceRegistry,
  type SourceRegistry,
} from "../db/repositories/source-registry";
import {
  buildPreloadedDealMemoryBundles,
} from "../lib/corpus/service";
import { DEMO_DEAL_EVIDENCE } from "../lib/corpus/evidence";
import { DEMO_FIXTURES } from "../lib/corpus/fixtures";
import {
  listDocumentDeals,
  listPreloadedDocuments,
} from "../lib/corpus/manifest";
import {
  companyIdForDeal,
  privateObjectKey,
} from "../lib/storage/service";

const PRELOADED_REVISION_TIME = "2026-07-28T00:00:00.000Z";

export interface BackfillSourceRegistryInput {
  workspaceId: string;
  assignedByUserId: string;
  sourceRegistry: SourceRegistry;
  dealRegistry: DealRegistry;
}

export interface BackfillSourceRegistryResult {
  sourceRevisionCount: number;
  eligibleDealCount: number;
}

export function preloadedSourceRevisionId(sourceId: string): string {
  return `source_revision_${sourceId}_1`;
}

export async function backfillPreloadedSourceRegistry(
  input: BackfillSourceRegistryInput,
): Promise<BackfillSourceRegistryResult> {
  const workspaceId = input.workspaceId?.trim();
  const assignedByUserId = input.assignedByUserId?.trim();
  if (!workspaceId) throw new Error("A workspace is required for backfill.");
  if (!assignedByUserId) {
    throw new Error("An assigning user is required for backfill.");
  }
  const revisions = new Map<string, string>();
  for (const document of listPreloadedDocuments()) {
    const revisionId = preloadedSourceRevisionId(document.id);
    const existing = await input.sourceRegistry.getRevision({
      workspaceId,
      revisionId,
    });
    if (
      existing
      && (
        existing.sourceId !== document.id
        || existing.revision !== 1
        || existing.contentHash !== document.checksum
        || existing.objectKey !== privateObjectKey(document)
        || existing.objectVersion !== document.checksum
        || existing.contentType !== "application/pdf"
        || existing.extractorId !== "preloaded-pdf"
        || existing.extractorVersion !== "1"
      )
    ) {
      throw new Error(
        `Preloaded source revision ${revisionId} contains different immutable source data.`,
      );
    }
    const revision = existing ??
      await input.sourceRegistry.createInitialRevision({
        id: revisionId,
        workspaceId,
        sourceId: document.id,
        contentHash: document.checksum,
        objectKey: privateObjectKey(document),
        objectVersion: document.checksum,
        contentType: "application/pdf",
        extractorId: "preloaded-pdf",
        extractorVersion: "1",
        extractedAt: PRELOADED_REVISION_TIME,
        createdAt: PRELOADED_REVISION_TIME,
      });
    revisions.set(document.id, revision.id);
  }

  const bundles = new Map(
    buildPreloadedDealMemoryBundles().map((bundle) => [bundle.dealId, bundle]),
  );
  let eligibleDealCount = 0;
  for (const document of listPreloadedDocuments()) {
    const sourceRevisionId = revisions.get(document.id)!;
    for (const deal of listDocumentDeals(document)) {
      const memoryBundle = bundles.get(deal.dealId);
      if (!memoryBundle) {
        throw new Error(
          `Preloaded Deal ${deal.dealId} has no source-backed memory bundle.`,
        );
      }
      await input.dealRegistry.confirmSourceAssignment({
        requestId: `preloaded:${workspaceId}:${deal.dealId}:${sourceRevisionId}`,
        workspaceId,
        dealId: deal.dealId,
        companyId: companyIdForDeal(deal.dealId),
        companyName: deal.company,
        status: memoryBundle.status,
        sourceRevisionId,
        assignedByUserId,
        reason: "Backfilled from the supplied private demo corpus.",
        confirmedAt: PRELOADED_REVISION_TIME,
        memoryBundle,
        memoryLineage: {
          evidence: Object.fromEntries(
            DEMO_DEAL_EVIDENCE
              .filter((item) => item.dealId === deal.dealId)
              .map((item) => [item.id, {
                workspaceId,
                dealId: deal.dealId,
                sourceId: item.documentId,
                sourceRevisionId: revisions.get(item.documentId)!,
              }]),
          ),
          interactions: Object.fromEntries(
            DEMO_FIXTURES
              .filter((item) => item.dealId === deal.dealId)
              .map((item) => [item.id, {
                workspaceId,
                dealId: deal.dealId,
                sourceId: item.documentId,
                sourceRevisionId: revisions.get(item.documentId)!,
              }]),
          ),
        },
      });
      eligibleDealCount += 1;
    }
  }

  return {
    sourceRevisionCount: revisions.size,
    eligibleDealCount,
  };
}

async function main(): Promise<void> {
  const workspaceId = process.env.DEMO_WORKSPACE_ID?.trim() || "workspace_demo";
  const assignedByUserId =
    process.env.DEMO_USER_ID?.trim() || "user_demo";
  const result = await backfillPreloadedSourceRegistry({
    workspaceId,
    assignedByUserId,
    sourceRegistry: getSourceRegistry(),
    dealRegistry: getDealRegistry(),
  });
  console.log(JSON.stringify(result));
}

const directEntry = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";
if (import.meta.url === directEntry) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
