import type { DealMemoryBundle } from "../lib/contracts/domain";
import type {
  ClaimedUploadedDocument,
  UploadedDocumentsRepository,
} from "../db/repositories/uploaded-documents";
import type { ExactSourceMemoryBundle } from "../db/repositories/deal-registry";
import type { PersistedIngest } from "../lib/xtrace/service";

export interface ConfirmedSourceLineage {
  sourceRevisionIds: string[];
  sourceIds: string[];
  fixtureIds: string[];
}

export async function processConfirmedSource(
  upload: ClaimedUploadedDocument,
  dependencies: {
    loadBundle: (
      upload: ClaimedUploadedDocument,
    ) => Promise<ExactSourceMemoryBundle | null>;
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
    const exact = await dependencies.loadBundle(upload);
    if (
      !exact
      || exact.workspaceId !== upload.workspaceId
      || exact.dealId !== upload.dealId
      || exact.sourceId !== upload.sourceId
      || exact.sourceRevisionId !== upload.sourceRevisionId
    ) {
      throw new Error(
        "Confirmed source facts do not match the exact revision ownership.",
      );
    }
    const bundle = exact.bundle;
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
