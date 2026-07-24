import { DEMO_FIXTURES, type DemoFixture } from "../corpus/fixtures";
import {
  listDocumentDeals,
  listPreloadedDocuments,
  type CorpusDocumentRole,
} from "../corpus/manifest";
import type { DealStatus } from "../contracts/domain";

export interface DemoDocumentView {
  id: string;
  title: string;
  filename: string;
  role: CorpusDocumentRole;
  companyName?: string;
  byteSize: number;
  importable: boolean;
  sourceUrl: string;
}

export interface DemoDealView {
  id: string;
  companyName: string;
  status: DealStatus;
  documentId: string;
  sourceTitle: string;
  sourceUrl: string;
  fixture?: Pick<
    DemoFixture,
    "id" | "label" | "provenance" | "meetingSummary" | "decisionReason" | "concerns" | "revisitConditions"
  >;
}

export interface DemoViewModel {
  generatedAt: string;
  windowDays: 14;
  stats: {
    deals: number;
    marketReports: number;
    referenceDocuments: number;
    fixtureDeals: number;
  };
  deals: DemoDealView[];
  documents: DemoDocumentView[];
}

const DEFAULT_DEAL_STATUS: DealStatus = "screening";

export function buildDemoViewModel(now = new Date()): DemoViewModel {
  const manifest = listPreloadedDocuments();
  const documents: DemoDocumentView[] = manifest.map((document) => ({
    id: document.id,
    title: document.title,
    filename: document.filename,
    role: document.role,
    companyName: document.company ?? (
      document.role === "deal_document"
        ? `${listDocumentDeals(document).length} page-level Deals`
        : undefined
    ),
    byteSize: document.byteSize,
    importable: document.role !== "reference",
    sourceUrl: `/api/documents/${encodeURIComponent(document.id)}/access`,
  }));
  const fixtures = new Map(DEMO_FIXTURES.map((fixture) => [fixture.dealId, fixture]));
  const deals: DemoDealView[] = manifest
    .filter((document) => document.role === "deal_document")
    .flatMap((document) =>
      listDocumentDeals(document).map((documentDeal) => {
        const fixture = fixtures.get(documentDeal.dealId);
        const pageAnchor = documentDeal.page ? `#page=${documentDeal.page}` : "";
        return {
        id: documentDeal.dealId,
        companyName: documentDeal.company,
        status: fixture?.status ?? DEFAULT_DEAL_STATUS,
        documentId: document.id,
        sourceTitle: document.title,
        sourceUrl: `/api/documents/${encodeURIComponent(document.id)}/access${pageAnchor}`,
        fixture: fixture
          ? {
              id: fixture.id,
              label: fixture.label,
              provenance: fixture.provenance,
              meetingSummary: fixture.meetingSummary,
              decisionReason: fixture.decisionReason,
              concerns: fixture.concerns,
              revisitConditions: fixture.revisitConditions,
            }
          : undefined,
        };
      })
    )
    .sort((left, right) => left.companyName.localeCompare(right.companyName));

  return {
    generatedAt: now.toISOString(),
    windowDays: 14,
    stats: {
      deals: deals.length,
      marketReports: documents.filter((document) => document.role === "market_report").length,
      referenceDocuments: documents.filter((document) => document.role === "reference").length,
      fixtureDeals: deals.filter((deal) => deal.fixture).length,
    },
    deals,
    documents,
  };
}
