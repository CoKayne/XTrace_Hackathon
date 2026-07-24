import manifest from "../../seed/manifest.json";

export type CorpusDocumentRole = "deal_document" | "market_report" | "reference";

export interface PreloadedDocument {
  id: string;
  filename: string;
  title: string;
  role: CorpusDocumentRole;
  company?: string;
  dealId?: string;
  checksum: string;
  byteSize: number;
}

const documents: readonly PreloadedDocument[] = manifest.documents.map((document) => ({
  ...document,
  role: parseDocumentRole(document.role),
}));

function parseDocumentRole(role: string): CorpusDocumentRole {
  if (role === "deal_document" || role === "market_report" || role === "reference") {
    return role;
  }

  throw new Error(`Invalid corpus document role: ${role}`);
}

export function listPreloadedDocuments(): readonly PreloadedDocument[] {
  return documents;
}

export function getPreloadedDocument(documentId: string): PreloadedDocument | undefined {
  return documents.find((document) => document.id === documentId);
}
