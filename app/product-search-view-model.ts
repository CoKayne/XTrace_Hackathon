import type {
  UnderwritingSearchResult,
} from "../lib/underwriting/read-model";

export interface ProductSearchCitation {
  id: string;
  provenance: "source_document";
  title: string;
  url: string;
  excerpt: string;
}

export function toProductSearchMessage(
  results: UnderwritingSearchResult[],
): {
  text: string;
  citations: ProductSearchCitation[];
} {
  const revisionIds = [...new Set(
    results.flatMap((result) => result.sourceRevisionIds),
  )].sort();
  return {
    text: results.length
      ? results.map((result) =>
          `${result.analysisType}: ${result.text}`
        ).join("\n\n")
      : "No finalized persisted underwriting artifact matched this query.",
    citations: revisionIds.map((sourceRevisionId) => ({
      id: sourceRevisionId,
      provenance: "source_document",
      title: `Source Revision ${sourceRevisionId}`,
      url: `/api/source-revisions/${
        encodeURIComponent(sourceRevisionId)
      }/access`,
      excerpt: "Finalized persisted underwriting source revision.",
    })),
  };
}
