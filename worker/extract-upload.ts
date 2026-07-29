import { z } from "zod";

import type {
  UploadedDocumentFact,
  UploadedDocumentRecord,
} from "../db/repositories/uploaded-documents";
import type { ClaudeClient } from "../lib/claude/client";
import type { DealMemoryBundle } from "../lib/contracts/domain";

export const MAX_EXTRACTION_CHARS = 40_000;
const MAX_FACTS = 8;

const ExtractionSchema = z.object({
  companyName: z.string().min(1).max(120),
  headline: z.string().min(1).max(400),
  facts: z.array(z.object({
    text: z.string().min(1).max(400),
    excerpt: z.string().min(1).max(600),
  })).max(20),
});

export class EmptyDocumentError extends Error {
  readonly code = "NO_READABLE_TEXT";
}

// Extraction reads document text in the Node worker: workerd cannot host the
// PDF/DOCX parsers, and the worker already owns every other long-running step.
// Pitch decks are typically exported as images with no text layer, so a PDF
// with no usable text falls back to reading the rendered pages with Claude.
export async function extractDocumentText(input: {
  bytes: Uint8Array;
  contentType: string;
  filename: string;
  client?: ClaudeClient;
}): Promise<string> {
  const normalized = normalizeText(await readDocument(input));
  if (normalized.length >= 40) return normalized.slice(0, MAX_EXTRACTION_CHARS);

  if (input.contentType === "application/pdf" && input.client) {
    const transcribed = normalizeText(
      await transcribePdf({ client: input.client, bytes: input.bytes }),
    );
    if (transcribed.length >= 40) return transcribed.slice(0, MAX_EXTRACTION_CHARS);
  }

  throw new EmptyDocumentError(
    "No readable text was found in this document.",
  );
}

async function transcribePdf(input: {
  client: ClaudeClient;
  bytes: Uint8Array;
}): Promise<string> {
  return input.client.complete({
    system: [
      "You transcribe documents. Output only the text visible in the document,",
      "page by page, exactly as written. Do not summarize, translate, comment,",
      "or add anything that is not printed in the document.",
    ].join(" "),
    messages: [{
      role: "user",
      content: [
        {
          type: "document",
          source: {
            type: "base64",
            media_type: "application/pdf",
            data: toBase64(input.bytes),
          },
        },
        { type: "text", text: "Transcribe every page of this document verbatim." },
      ],
    }],
    maxTokens: 8_000,
  });
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function normalizeText(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
}

async function readDocument(input: {
  bytes: Uint8Array;
  contentType: string;
  filename: string;
}): Promise<string> {
  if (input.contentType === "application/pdf") {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const copy = new Uint8Array(input.bytes.byteLength);
    copy.set(input.bytes);
    const pdf = await getDocumentProxy(copy);
    const { text } = await extractText(pdf, { mergePages: true });
    return Array.isArray(text) ? text.join("\n") : text;
  }
  if (
    input.contentType
      === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({
      buffer: Buffer.from(input.bytes),
    });
    return result.value;
  }
  return new TextDecoder().decode(input.bytes);
}

// The model only names the company and copies supporting sentences; every
// excerpt is verified against the document text before it becomes a fact.
export async function extractDealProfile(input: {
  client: ClaudeClient;
  documentText: string;
  filename: string;
}): Promise<{
  companyName: string;
  headline: string;
  facts: UploadedDocumentFact[];
}> {
  const system = [
    "You read a single venture pitch or company document and report what it says.",
    "Do not infer, estimate, or add anything the document does not state.",
    "Every excerpt must be an exact, character-for-character contiguous quote copied from the document text; never paraphrase inside an excerpt.",
    "facts summarize the excerpt in one short sentence each; report the most decision-relevant facts first (what the company does, traction, market, funding).",
    "If the document does not name a company, use the most specific product or project name it does state.",
    "Return JSON only, matching the requested schema.",
  ].join(" ");
  const requestContent = JSON.stringify({
    task: "Extract the company profile stated by this document.",
    outputSchema: {
      companyName: "the company or product name stated in the document",
      headline: "one sentence describing what the company does, in the document's own terms",
      facts: [{
        text: "one-sentence summary of the excerpt",
        excerpt: "exact quote copied from documentText",
      }],
    },
    filename: input.filename,
    documentText: input.documentText,
  });
  const response = await input.client.complete({
    system,
    messages: [{ role: "user", content: requestContent }],
    maxTokens: 3_000,
  });
  const parsed = ExtractionSchema.parse(parseJson(response));
  const haystack = normalizeForMatch(input.documentText);
  const facts = parsed.facts
    .filter((fact) => haystack.includes(normalizeForMatch(fact.excerpt)))
    .slice(0, MAX_FACTS);
  return {
    companyName: parsed.companyName.trim(),
    headline: parsed.headline.trim(),
    facts,
  };
}

export function buildUploadedDealBundle(input: {
  record: UploadedDocumentRecord;
  dealId: string;
  companyName: string;
  headline: string;
  facts: UploadedDocumentFact[];
}): DealMemoryBundle {
  const sources = input.facts.map((fact, index) => ({
    id: `${input.record.id}_fact_${index + 1}`,
    provenance: "source_document" as const,
    title: input.record.filename,
    documentId: input.record.id,
    excerpt: fact.excerpt,
  }));
  const headlineSource = {
    id: `${input.record.id}_headline`,
    provenance: "source_document" as const,
    title: input.record.filename,
    documentId: input.record.id,
    excerpt: input.headline,
  };
  return {
    dealId: input.dealId,
    companyName: input.companyName,
    // A freshly uploaded document is an inbound Deal nobody has decided on, so
    // it carries no synthetic decision record.
    status: "screening",
    facts: [
      { text: input.headline, sources: [headlineSource] },
      ...input.facts.map((fact, index) => ({
        text: fact.text,
        sources: [sources[index]],
      })),
    ],
    interactions: [],
  };
}

export function uploadRecallQuery(input: {
  companyName: string;
  headline: string;
  facts: UploadedDocumentFact[];
}): string {
  return [
    input.companyName,
    input.headline,
    ...input.facts.map((fact) => fact.text),
  ].join(" · ").slice(0, 4_000);
}

function normalizeForMatch(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function parseJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return JSON.parse(fenced?.[1] ?? trimmed);
}
