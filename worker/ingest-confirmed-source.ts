import type { DealMemoryBundle } from "../lib/contracts/domain";
import type {
  ClaimedUploadedDocument,
  UploadedDocumentsRepository,
} from "../db/repositories/uploaded-documents";
import type { PersistedIngest } from "../lib/xtrace/service";

export interface ConfirmedSourceLineage {
  sourceRevisionIds: string[];
  sourceIds: string[];
  fixtureIds: string[];
}

export function selectConfirmedSourceBundle(
  bundle: DealMemoryBundle,
  sourceId: string,
): DealMemoryBundle {
  return {
    ...bundle,
    facts: bundle.facts.flatMap((fact) => {
      const sources = fact.sources.filter((source) =>
        source.documentId === sourceId
      );
      return sources.length > 0 ? [{ ...fact, sources }] : [];
    }),
    interactions: [],
  };
}

export async function processConfirmedSource(
  upload: ClaimedUploadedDocument,
  dependencies: {
    loadBundle: (upload: ClaimedUploadedDocument) => Promise<DealMemoryBundle>;
    ingest: (
      bundle: DealMemoryBundle,
      lineage: ConfirmedSourceLineage,
    ) => Promise<PersistedIngest>;
    poll?: (
      jobId: string,
      options: { dealId: string },
    ) => Promise<PersistedIngest>;
    complete: UploadedDocumentsRepository["completeConfirmed"];
    fail?: UploadedDocumentsRepository["failConfirmed"];
  },
): Promise<PersistedIngest> {
  try {
    if (!upload.dealId || !upload.sourceId || !upload.sourceRevisionId) {
      throw new Error("Confirmed upload lineage is incomplete.");
    }
    const loadedBundle = await dependencies.loadBundle(upload);
    if (loadedBundle.dealId !== upload.dealId) {
      throw new Error("Confirmed upload Deal identity changed before ingest.");
    }
    const bundle = selectConfirmedSourceBundle(
      loadedBundle,
      upload.sourceId,
    );
    if (bundle.facts.length === 0) {
      throw new Error("Confirmed source has no exact source-backed facts.");
    }
    const exactLineage: ConfirmedSourceLineage = {
      sourceRevisionIds: [upload.sourceRevisionId],
      sourceIds: [upload.sourceId],
      fixtureIds: [],
    };
    let result = await dependencies.ingest(bundle, exactLineage);
    if (
      (result.status === "pending" || result.status === "running")
      && dependencies.poll
    ) {
      result = await dependencies.poll(result.jobId, {
        dealId: bundle.dealId,
      });
    }
    if (result.status !== "succeeded") {
      throw new Error(`XTrace ingest ended in ${result.status}.`);
    }
    const completed = await dependencies.complete({
      workspaceId: upload.workspaceId,
      id: upload.id,
      workerId: upload.workerId,
      leaseToken: upload.leaseToken,
    });
    if (!completed) {
      throw new Error(
        "Confirmed upload claim was lost before completion.",
      );
    }
    return result;
  } catch (error) {
    await dependencies.fail?.({
      workspaceId: upload.workspaceId,
      id: upload.id,
      workerId: upload.workerId,
      leaseToken: upload.leaseToken,
      reason: "Memory ingestion failed. Retry is available.",
    });
    throw error;
  }
}
