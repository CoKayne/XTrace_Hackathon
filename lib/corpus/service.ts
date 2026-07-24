import { DealMemoryBundleSchema, type DealMemoryBundle } from "../contracts/domain";
import { getDemoEvidenceForDeal } from "./evidence";
import {
  getDemoFixtureForDeal,
  type DemoFixture,
} from "./fixtures";
import {
  getPreloadedDocument,
  listDocumentDeals,
  listPreloadedDocuments,
  type PreloadedDeal,
  type PreloadedDocument,
} from "./manifest";

export interface ImportPreviewItem {
  documentId: string;
  title: string;
  classification: "deal_document" | "market_report";
  company?: string;
  deals: Array<{ dealId: string; companyName: string; page?: number }>;
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
  ensureFixture(input: { workspaceId: string; fixture: DemoFixture }): Promise<{ fixtureId: string }>;
  createPrivateReadUrl(input: { documentId: string; expiresInSeconds: number }): Promise<string>;
}

export interface CorpusService {
  list(): readonly PreloadedDocument[];
  previewImport(documentIds: string[]): ImportPreviewItem[];
  confirmImport(input: ConfirmImportInput): Promise<ConfirmImportResult>;
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
    if (document.role === "reference") {
      throw new Error(`Document ${documentId} is reference-only and cannot be imported.`);
    }

    return {
      documentId: document.id,
      title: document.title,
      classification: document.role,
      company: document.company,
      deals: listDocumentDeals(document).map((deal) => ({
        dealId: deal.dealId,
        companyName: deal.company,
        page: deal.page,
      })),
      requiresDealConfirmation: document.role === "deal_document",
    };
  });
}

export function buildPreloadedDealMemoryBundles(): DealMemoryBundle[] {
  return listPreloadedDocuments()
    .filter((document) => document.role === "deal_document")
    .flatMap((document) =>
      listDocumentDeals(document).flatMap((deal) => {
        const bundle = createMemoryBundle(
          document,
          deal,
          getDemoFixtureForDeal(deal.dealId),
        );
        return bundle ? [bundle] : [];
      })
    );
}

export function createCorpusService(persistence: CorpusPersistence): CorpusService {
  return {
    list: listPreloadedDocuments,
    previewImport,
    confirmImport: (input) => confirmImport(input, persistence),
    getSignedDocumentUrl: (documentId) => getSignedDocumentUrl(documentId, persistence),
  };
}

export async function getSignedDocumentUrl(
  documentId: string,
  persistence: Pick<CorpusPersistence, "createPrivateReadUrl">,
): Promise<string> {
  if (!getPreloadedDocument(documentId)) {
    throw new Error(`Unknown preloaded document: ${documentId}`);
  }

  return persistence.createPrivateReadUrl({
    documentId,
    expiresInSeconds: SIGNED_DOCUMENT_URL_TTL_SECONDS,
  });
}

export async function confirmImport(
  input: ConfirmImportInput,
  persistence: CorpusPersistence,
): Promise<ConfirmImportResult> {
  const validated = validateConfirmImport(input);
  const memoryBundles: DealMemoryBundle[] = [];

  for (const item of validated.items) {
    await persistence.ensureWorkspaceDocument({
      workspaceId: validated.workspaceId,
      documentId: item.document.id,
    });

    for (const confirmation of item.confirmations) {
      const documentDeal = listDocumentDeals(item.document)
        .find((deal) => deal.dealId === confirmation.dealId);
      if (!documentDeal) continue;
      await persistence.ensureDeal({
        workspaceId: validated.workspaceId,
        dealId: confirmation.dealId,
        companyName: documentDeal.company,
      });
      const fixture = getDemoFixtureForDeal(confirmation.dealId);
      if (fixture) {
        await persistence.ensureFixture({
          workspaceId: validated.workspaceId,
          fixture,
        });
      }
      const memoryBundle = createMemoryBundle(item.document, documentDeal, fixture);
      if (memoryBundle) memoryBundles.push(memoryBundle);
    }
  }

  return {
    documentIds: validated.items.map((item) => item.document.id),
    memoryBundles,
  };
}

function validateConfirmImport(input: ConfirmImportInput): {
  workspaceId: string;
  items: Array<{
    document: PreloadedDocument;
    confirmations: Array<{ documentId: string; dealId: string }>;
  }>;
} {
  const workspaceId = input.workspaceId.trim();
  if (!workspaceId) {
    throw new Error("A workspace is required to confirm an import.");
  }
  if (input.documentIds.length === 0) {
    throw new Error("At least one preloaded document is required.");
  }

  assertNoDuplicates(input.documentIds, "document id");
  assertNoDuplicates(
    input.dealConfirmations.map((confirmation) =>
      `${confirmation.documentId}:${confirmation.dealId}`
    ),
    "Deal confirmation",
  );
  const preview = previewImport(input.documentIds);
  const selectedIds = new Set(input.documentIds);

  for (const confirmation of input.dealConfirmations) {
    if (!selectedIds.has(confirmation.documentId)) {
      throw new Error(`Deal confirmation supplied for unselected document ${confirmation.documentId}.`);
    }
  }

  const items = preview.map((item) => {
    const document = getPreloadedDocument(item.documentId)!;
    const confirmations = input.dealConfirmations.filter(
      (confirmation) => confirmation.documentId === item.documentId,
    );

    if (document.role === "market_report") {
      if (confirmations.length) {
        throw new Error(`Market report ${document.id} cannot have a Deal confirmation.`);
      }
      return { document, confirmations: [] };
    }

    const expectedDealIds = listDocumentDeals(document).map((deal) => deal.dealId);
    const confirmedDealIds = confirmations.map((confirmation) => confirmation.dealId);
    const unknownDealIds = confirmedDealIds.filter(
      (dealId) => !expectedDealIds.includes(dealId),
    );
    if (unknownDealIds.length) {
      throw new Error(
        `Document ${document.id} contains no Deal ${unknownDealIds[0]}.`,
      );
    }
    const missingDealIds = expectedDealIds.filter(
      (dealId) => !confirmedDealIds.includes(dealId),
    );
    if (missingDealIds.length) {
      throw new Error(
        `Document ${document.id} requires confirmation for Deal ${missingDealIds[0]}.`,
      );
    }
    return { document, confirmations };
  });

  return { workspaceId, items };
}

function createMemoryBundle(
  document: PreloadedDocument,
  deal: PreloadedDeal,
  fixture?: DemoFixture,
): DealMemoryBundle | undefined {
  const evidence = getDemoEvidenceForDeal(deal.dealId);
  if (!evidence) return undefined;

  return DealMemoryBundleSchema.parse({
    dealId: deal.dealId,
    companyName: deal.company,
    status: fixture?.status ?? "screening",
    facts: [{
      text: evidence.fact,
      sources: [{
        id: evidence.id,
        provenance: evidence.provenance,
        title: document.title,
        documentId: document.id,
        page: evidence.page,
        excerpt: evidence.excerpt,
      }],
    }],
    interactions: fixture
      ? [{
          id: fixture.id,
          occurredAt: fixture.occurredAt,
          summary: fixture.meetingSummary,
          decisionReason: fixture.decisionReason,
          concerns: fixture.concerns,
          revisitConditions: fixture.revisitConditions,
          provenance: fixture.provenance,
          label: fixture.label,
        }]
      : [],
  });
}

function assertNoDuplicates(values: readonly string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      throw new Error(`Duplicate ${label}: ${value}`);
    }
    seen.add(value);
  }
}
