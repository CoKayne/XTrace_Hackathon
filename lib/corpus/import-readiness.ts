import type { DemoDataStore } from "../storage/service";
import { listPreloadedDocuments } from "./manifest";

export interface ProductInputReadiness {
  ready: boolean;
  confirmedCount: number;
  requiredCount: number;
  missingDocumentIds: string[];
}

export interface ProductInputGate {
  assertReady(workspaceId: string): Promise<void>;
}

export async function getProductInputReadiness(
  store: Pick<DemoDataStore, "listWorkspaceDocumentIds">,
  workspaceId: string,
): Promise<ProductInputReadiness> {
  const requiredDocumentIds = listPreloadedDocuments()
    .filter((document) => document.role !== "reference")
    .map((document) => document.id);
  const confirmedDocumentIds = new Set(
    await store.listWorkspaceDocumentIds(workspaceId),
  );
  const missingDocumentIds = requiredDocumentIds.filter(
    (documentId) => !confirmedDocumentIds.has(documentId),
  );
  const confirmedCount = requiredDocumentIds.length - missingDocumentIds.length;

  return {
    ready: missingDocumentIds.length === 0,
    confirmedCount,
    requiredCount: requiredDocumentIds.length,
    missingDocumentIds,
  };
}

export function createProductInputGate(
  store: Pick<DemoDataStore, "listWorkspaceDocumentIds">,
): ProductInputGate {
  return {
    async assertReady(workspaceId) {
      const readiness = await getProductInputReadiness(store, workspaceId);
      if (readiness.ready) return;
      throw new Error(
        `The fixed MVP corpus is not confirmed: ${readiness.confirmedCount} of ${readiness.requiredCount} product inputs are durable.`,
      );
    },
  };
}
