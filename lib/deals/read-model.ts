import type {
  DealRegistry,
  RegisteredDeal,
} from "../../db/repositories/deal-registry";
import type {
  IntelligenceRepository,
} from "../../db/repositories/intelligence";
import type {
  UploadedDocumentsRepository,
} from "../../db/repositories/uploaded-documents";

export interface ProductDealView {
  id: string;
  companyName: string;
  status: RegisteredDeal["status"];
  documentId: string;
  sourceTitle: string;
  sourceUrl: string;
  sourceRevisionIds: string[];
  sourceCount: number;
  sourceLinks: Array<{
    sourceRevisionId: string;
    sourceUrl: string;
  }>;
}

export function toProductDealView(deal: RegisteredDeal): ProductDealView {
  const sourceRevisionIds = [...deal.activeSourceRevisionIds];
  const sourceLinks = sourceRevisionIds.map((sourceRevisionId) => ({
    sourceRevisionId,
    sourceUrl:
      `/api/source-revisions/${encodeURIComponent(sourceRevisionId)}/access`,
  }));
  const primary = sourceLinks[0] ?? null;
  return {
    id: deal.id,
    companyName: deal.companyName,
    status: deal.status,
    documentId: primary?.sourceRevisionId ?? "",
    sourceTitle: sourceRevisionIds.length === 1
      ? "1 confirmed source"
      : `${sourceRevisionIds.length} confirmed sources`,
    sourceUrl: primary?.sourceUrl ?? "",
    sourceRevisionIds,
    sourceCount: sourceRevisionIds.length,
    sourceLinks,
  };
}

export async function listProductDeals(input: {
  workspaceId: string;
  query: string;
  status: string;
  deals: DealRegistry;
}): Promise<ProductDealView[]> {
  const query = input.query.toLocaleLowerCase();
  return (await input.deals.listForWorkspace(input.workspaceId))
    .map(toProductDealView)
    .filter((deal) => {
      if (input.status && deal.status !== input.status) return false;
      if (!query) return true;
      return [
        deal.id,
        deal.companyName,
        deal.status,
        ...deal.sourceRevisionIds,
      ].join(" ").toLocaleLowerCase().includes(query);
    });
}

export async function buildProductOverview(input: {
  workspaceId: string;
  deals: DealRegistry;
  intelligence: IntelligenceRepository;
  uploads: UploadedDocumentsRepository;
  now: () => number;
}) {
  const [deals, reports, uploads] = await Promise.all([
    input.deals.listForWorkspace(input.workspaceId),
    input.intelligence.listReports(input.workspaceId),
    input.uploads.list(input.workspaceId),
  ]);
  const publicDeals = deals.map(toProductDealView);
  return {
    generatedAt: new Date(input.now()).toISOString(),
    windowDays: 14 as const,
    stats: {
      deals: publicDeals.length,
      marketReports: reports.length,
      referenceDocuments: 0,
      fixtureDeals: 0,
      activeSourceRevisions: publicDeals.reduce(
        (count, deal) => count + deal.sourceCount,
        0,
      ),
      uploads: uploads.length,
    },
    deals: publicDeals,
    documents: [],
  };
}
