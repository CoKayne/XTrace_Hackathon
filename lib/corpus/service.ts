import { DealMemoryBundleSchema, type DealMemoryBundle } from "../contracts/domain";
import { getDemoFixtureForDocument } from "./fixtures";
import { getPreloadedDocument } from "./manifest";

export interface ImportPreviewItem {
  documentId: string;
  title: string;
  classification: "deal_document" | "market_report" | "reference";
  company?: string;
  requiresDealConfirmation: boolean;
}

export interface ConfirmImportInput {
  workspaceId: string;
  documentIds: string[];
  dealConfirmations: Array<{ documentId: string; dealId: string }>;
}

export interface CorpusPersistence {
  ensureWorkspaceDocument(input: { workspaceId: string; documentId: string }): Promise<{ documentId: string }>;
  ensureDeal(input: { workspaceId: string; dealId: string; companyName: string }): Promise<{ dealId: string }>;
  ensureFixture(input: { workspaceId: string; fixtureId: string; dealId: string }): Promise<{ fixtureId: string }>;
  createSignedReadUrl(input: { documentId: string; expiresInSeconds: number }): Promise<string>;
}

export interface CorpusService extends CorpusPersistence {
  getSignedDocumentUrl(documentId: string): Promise<string>;
}

export interface ConfirmImportResult {
  documentIds: string[];
  memoryBundles: DealMemoryBundle[];
}

const SIGNED_DOCUMENT_URL_TTL_SECONDS = 10 * 60;

export function previewImport(documentIds: string[]): ImportPreviewItem[] {
  return documentIds.map((documentId) => {
    const document = getPreloadedDocument(documentId);
    if (!document) {
      throw new Error(`Unknown preloaded document: ${documentId}`);
    }

    return {
      documentId: document.id,
      title: document.title,
      classification: document.role,
      company: document.company,
      requiresDealConfirmation: document.role === "deal_document",
    };
  });
}

export function createCorpusService(persistence: CorpusPersistence): CorpusService {
  return {
    ...persistence,
    getSignedDocumentUrl: (documentId) => getSignedDocumentUrl(documentId, persistence),
  };
}

export async function getSignedDocumentUrl(
  documentId: string,
  persistence: Pick<CorpusPersistence, "createSignedReadUrl">,
): Promise<string> {
  if (!getPreloadedDocument(documentId)) {
    throw new Error(`Unknown preloaded document: ${documentId}`);
  }

  return persistence.createSignedReadUrl({
    documentId,
    expiresInSeconds: SIGNED_DOCUMENT_URL_TTL_SECONDS,
  });
}

export async function confirmImport(
  input: ConfirmImportInput,
  persistence: CorpusPersistence,
): Promise<ConfirmImportResult> {
  if (!input.workspaceId) {
    throw new Error("A workspace is required to confirm an import.");
  }

  const preview = previewImport(input.documentIds);
  const confirmations = new Map(input.dealConfirmations.map((confirmation) => [confirmation.documentId, confirmation]));
  const memoryBundles: DealMemoryBundle[] = [];

  for (const item of preview) {
    await persistence.ensureWorkspaceDocument({ workspaceId: input.workspaceId, documentId: item.documentId });

    if (!item.requiresDealConfirmation) {
      continue;
    }

    const confirmation = confirmations.get(item.documentId);
    if (!confirmation?.dealId || !item.company) {
      throw new Error(`Document ${item.documentId} requires a confirmed Deal.`);
    }

    await persistence.ensureDeal({
      workspaceId: input.workspaceId,
      dealId: confirmation.dealId,
      companyName: item.company,
    });

    const fixture = getDemoFixtureForDocument(item.documentId);
    if (!fixture || fixture.dealId !== confirmation.dealId) {
      continue;
    }

    await persistence.ensureFixture({
      workspaceId: input.workspaceId,
      fixtureId: fixture.id,
      dealId: fixture.dealId,
    });
    memoryBundles.push(createMemoryBundle(fixture, item.documentId, item.title));
  }

  return { documentIds: [...input.documentIds], memoryBundles };
}

function createMemoryBundle(
  fixture: NonNullable<ReturnType<typeof getDemoFixtureForDocument>>,
  documentId: string,
  title: string,
): DealMemoryBundle {
  return DealMemoryBundleSchema.parse({
    dealId: fixture.dealId,
    companyName: fixture.companyName,
    status: fixture.status,
    facts: [{
      text: `This Deal is linked to the supplied ${title}.`,
      sources: [{
        id: `source_${documentId}`,
        provenance: "source_document",
        title,
        documentId,
        excerpt: "Included in the fixed demo corpus.",
      }],
    }],
    interactions: [{
      id: fixture.id,
      occurredAt: fixture.occurredAt,
      summary: fixture.meetingSummary,
      concerns: fixture.concerns,
      revisitConditions: fixture.revisitConditions,
      provenance: fixture.provenance,
    }],
  });
}
