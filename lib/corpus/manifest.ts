import { z } from "zod";

import manifest from "../../seed/manifest.json";

export type CorpusDocumentRole = "deal_document" | "market_report" | "reference";

export interface PreloadedDeal {
  company: string;
  dealId: string;
  page?: number;
}

export interface PreloadedDocument {
  id: string;
  filename: string;
  title: string;
  role: CorpusDocumentRole;
  company?: string;
  dealId?: string;
  deals?: readonly PreloadedDeal[];
  checksum: string;
  byteSize: number;
}

const CorpusDocumentSchema = z.object({
  id: z.string().min(1).regex(/^[a-z0-9_]+$/, "Document id must use lowercase letters, digits, and underscores"),
  filename: z.string().min(1).regex(/^[^/\\]+\.pdf$/i, "Document filename must be a basename ending in .pdf"),
  title: z.string().min(1),
  role: z.enum(["deal_document", "market_report", "reference"]),
  company: z.string().min(1).optional(),
  dealId: z.string().min(1).optional(),
  deals: z.array(z.object({
    company: z.string().min(1),
    dealId: z.string().min(1),
    page: z.number().int().positive().optional(),
  }).strict()).min(2).optional(),
  checksum: z.string().regex(/^[a-f0-9]{64}$/, "Document checksum must be a lowercase SHA-256 digest"),
  byteSize: z.number().int().positive(),
}).strict().superRefine((document, context) => {
  if (document.role === "deal_document") {
    const hasSingleDeal = Boolean(document.company && document.dealId);
    const hasMultipleDeals = Boolean(document.deals?.length);
    if (hasSingleDeal === hasMultipleDeals) {
      context.addIssue({
        code: "custom",
        message: "A deal_document requires either company/dealId or a multi-Deal page list",
      });
    }
    if (Boolean(document.company) !== Boolean(document.dealId)) {
      context.addIssue({
        code: "custom",
        message: "A single-Deal document requires both company and dealId",
      });
    }
    return;
  }

  if (
    document.company !== undefined ||
    document.dealId !== undefined ||
    document.deals !== undefined
  ) {
    context.addIssue({
      code: "custom",
      message: `${document.role} entries cannot declare company or dealId`,
    });
  }
});

const CorpusManifestSchema = z.object({
  version: z.literal(1),
  documents: z.array(CorpusDocumentSchema).length(14),
}).strict();

export function parseCorpusManifest(input: unknown): readonly PreloadedDocument[] {
  const parsed = CorpusManifestSchema.parse(input);
  assertUnique(parsed.documents, "id", "document id");
  assertUnique(parsed.documents, "filename", "filename");
  assertUnique(parsed.documents, "checksum", "checksum");
  assertUniqueDeals(parsed.documents.flatMap(listDocumentDeals));
  assertRoleCount(parsed.documents, "deal_document", 9);
  assertRoleCount(parsed.documents, "market_report", 4);
  assertRoleCount(parsed.documents, "reference", 1);

  return Object.freeze(parsed.documents.map((document) => Object.freeze({ ...document })));
}

const documents = parseCorpusManifest(manifest);

export function listPreloadedDocuments(): readonly PreloadedDocument[] {
  return documents;
}

export function getPreloadedDocument(documentId: string): PreloadedDocument | undefined {
  return documents.find((document) => document.id === documentId);
}

export function listDocumentDeals(document: PreloadedDocument): readonly PreloadedDeal[] {
  if (document.role !== "deal_document") return [];
  return document.deals ?? [{
    company: document.company!,
    dealId: document.dealId!,
  }];
}

export function getPreloadedDeal(dealId: string): {
  document: PreloadedDocument;
  deal: PreloadedDeal;
} | undefined {
  for (const document of documents) {
    const deal = listDocumentDeals(document).find((item) => item.dealId === dealId);
    if (deal) return { document, deal };
  }
  return undefined;
}

function assertUnique(
  values: readonly PreloadedDocument[],
  key: "id" | "filename" | "checksum",
  label: string,
): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value[key])) {
      throw new Error(`Duplicate ${label}: ${value[key]}`);
    }
    seen.add(value[key]);
  }
}

function assertRoleCount(
  values: readonly PreloadedDocument[],
  role: CorpusDocumentRole,
  expected: number,
): void {
  const actual = values.filter((document) => document.role === role).length;
  if (actual !== expected) {
    throw new Error(`Corpus must contain exactly ${expected} ${role} entries; received ${actual}.`);
  }
}

function assertUniqueDeals(values: readonly PreloadedDeal[]): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value.dealId)) {
      throw new Error(`Duplicate Deal id: ${value.dealId}`);
    }
    seen.add(value.dealId);
  }
}
