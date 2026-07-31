import { z } from "zod";

import type {
  ClaimedUploadedDocument,
  ExtractionPreview,
  UploadedDocumentRecord,
} from "../db/repositories/uploaded-documents";
import type { ClaudeClient } from "../lib/claude/client";
import { DOCX_CONTENT_TYPE, sha256Hex } from "../lib/uploads/service";

const MAX_PDF_PAGES = 100;
const MAX_EXTRACTED_CHARACTERS = 2_000_000;
const MAX_DOCX_ENTRIES = 2_000;
const MAX_DOCX_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;
const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_EOCD_MAX_SEARCH_BYTES = 65_557;

const ExtractionSchema = z.object({
  companyName: z.string().min(1).max(120).nullable(),
  headline: z.string().min(1).max(400).nullable(),
  facts: z.array(z.object({
    text: z.string().min(1).max(400),
    excerpt: z.string().min(1).max(600).nullable(),
    structured: z.object({
      field: z.string().min(1).max(120),
      value: z.string().min(1).max(200),
      unit: z.string().min(1).max(40).nullable(),
      currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
      periodStart: z.iso.date().nullable(),
      periodEnd: z.iso.date().nullable(),
      publishedAt: z.iso.datetime({ offset: true }).nullable(),
      eventAt: z.iso.datetime({ offset: true }).nullable(),
    }).nullable().optional(),
  })),
});

export class EmptyDocumentError extends Error {
  readonly code = "NO_READABLE_TEXT";

  constructor(message: string) {
    super(message);
    this.name = "EmptyDocumentError";
  }
}

export class UnsupportedDocumentError extends Error {
  readonly code = "UNSUPPORTED_DOCUMENT";

  constructor(message: string) {
    super(message);
    this.name = "UnsupportedDocumentError";
  }
}

export interface ExtractedSegment {
  text: string;
  start: number;
  end: number;
  locator:
    | { kind: "text_range" }
    | { kind: "pdf_page"; page: number };
}

export interface ExtractedUploadContent {
  text: string;
  segments: ExtractedSegment[];
  extractorId:
    | "plain_text_v1"
    | "pdf_text_v1"
    | "docx_text_v1"
    | "claude_vision_v1";
  modelDerived: boolean;
}

export async function extractDocumentText(input: {
  bytes: Uint8Array;
  contentType: string;
  filename: string;
  client?: ClaudeClient;
}): Promise<string> {
  return (await extractDocumentContent(input)).text;
}

export async function extractDocumentContent(input: {
  bytes: Uint8Array;
  contentType: string;
  filename: string;
  client?: ClaudeClient;
}): Promise<ExtractedUploadContent> {
  if (input.contentType === "text/plain" || input.contentType === "text/markdown") {
    const text = new TextDecoder().decode(input.bytes);
    assertReadableBoundedText(text);
    return {
      text,
      segments: [{
        text,
        start: 0,
        end: text.length,
        locator: { kind: "text_range" },
      }],
      extractorId: "plain_text_v1",
      modelDerived: false,
    };
  }
  if (input.contentType === "application/pdf") {
    return extractPdfContent(input.bytes);
  }
  if (input.contentType === DOCX_CONTENT_TYPE) {
    return extractDocxContent(input.bytes);
  }
  if (!input.client) {
    throw new Error("Image extraction requires an Anthropic client.");
  }
  const text = await transcribeImage({
    client: input.client,
    bytes: input.bytes,
    contentType: imageContentType(input.contentType),
  });
  assertReadableBoundedText(text);
  return {
    text,
    segments: [],
    extractorId: "claude_vision_v1",
    modelDerived: true,
  };
}

export async function extractUploadPreview(input: {
  record: UploadedDocumentRecord;
  bytes: Uint8Array;
  client: ClaudeClient;
  extractedAt?: string;
}): Promise<ExtractionPreview> {
  const content = await extractDocumentContent({
    bytes: input.bytes,
    contentType: input.record.contentType,
    filename: input.record.filename,
    client: input.client,
  });
  const profile = await extractDealProfile({
    client: input.client,
    documentText: content.text,
    filename: input.record.filename,
  });
  const facts: ExtractionPreview["facts"] = [];
  for (const fact of profile.facts) {
    if (content.modelDerived) {
      facts.push({
        text: fact.text,
        excerpt: null,
        locator: { kind: "image", imageIndex: 0 },
        ...(fact.structured ? { structured: fact.structured } : {}),
      });
      continue;
    }
    if (!fact.excerpt) continue;
    const located = locateExactExcerpt(content, fact.excerpt);
    if (!located) continue;
    facts.push({
      text: fact.text,
      excerpt: fact.excerpt,
      locator: located,
      ...(fact.structured ? { structured: fact.structured } : {}),
    });
  }
  return {
    candidateCompanyName: profile.companyName,
    candidateHeadline: profile.headline,
    facts,
    extractionMetadata: {
      extractorId: content.extractorId,
      extractorVersion: "1",
      extractedAt: input.extractedAt ?? new Date().toISOString(),
      contentHash: await sha256Hex(input.bytes),
      inputBytes: input.bytes.byteLength,
      extractedCharacters: content.text.length,
      truncated: false,
    },
  };
}

async function extractPdfContent(
  bytes: Uint8Array,
): Promise<ExtractedUploadContent> {
  ensureMathSumPrecise();
  const { extractText, getDocumentProxy } = await import("unpdf");
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>> | undefined;
  try {
    pdf = await getDocumentProxy(new Uint8Array(bytes));
    if (pdf.numPages > MAX_PDF_PAGES) {
      throw new UnsupportedDocumentError("PDF exceeds 100 pages.");
    }
    const { text } = await extractText(pdf, { mergePages: false });
    const pages = Array.isArray(text) ? text : [text];
    let completeText = "";
    const segments: ExtractedSegment[] = [];
    for (let index = 0; index < pages.length; index += 1) {
      if (index > 0) completeText += "\n\n";
      const pageText = pages[index] ?? "";
      const start = completeText.length;
      completeText += pageText;
      if (completeText.length > MAX_EXTRACTED_CHARACTERS) {
        throw new UnsupportedDocumentError(
          "Extracted text exceeds 2,000,000 characters.",
        );
      }
      segments.push({
        text: pageText,
        start,
        end: completeText.length,
        locator: { kind: "pdf_page", page: index + 1 },
      });
    }
    assertReadableBoundedText(completeText);
    return {
      text: completeText,
      segments,
      extractorId: "pdf_text_v1",
      modelDerived: false,
    };
  } catch (error) {
    if (
      error instanceof EmptyDocumentError
      || error instanceof UnsupportedDocumentError
    ) {
      throw error;
    }
    if (isPasswordProtectedPdfError(error)) {
      throw new UnsupportedDocumentError(
        "Password-protected PDFs are not supported.",
      );
    }
    throw new UnsupportedDocumentError("PDF could not be read.");
  } finally {
    if (pdf) await pdf.loadingTask.destroy();
  }
}

async function extractDocxContent(
  bytes: Uint8Array,
): Promise<ExtractedUploadContent> {
  inspectDocxCentralDirectory(bytes);
  try {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({
      buffer: Buffer.from(bytes),
    });
    const text = result.value;
    assertReadableBoundedText(text);
    return {
      text,
      segments: [{
        text,
        start: 0,
        end: text.length,
        locator: { kind: "text_range" },
      }],
      extractorId: "docx_text_v1",
      modelDerived: false,
    };
  } catch (error) {
    if (
      error instanceof EmptyDocumentError
      || error instanceof UnsupportedDocumentError
    ) {
      throw error;
    }
    throw new UnsupportedDocumentError("DOCX could not be read.");
  }
}

function locateExactExcerpt(
  content: ExtractedUploadContent,
  excerpt: string,
): ExtractionPreview["facts"][number]["locator"] | null {
  let searchFrom = 0;
  while (searchFrom <= content.text.length - excerpt.length) {
    const start = content.text.indexOf(excerpt, searchFrom);
    if (start < 0) return null;
    const end = start + excerpt.length;
    const segment = content.segments.find((candidate) =>
      start >= candidate.start && end <= candidate.end
    );
    if (segment) {
      return segment.locator.kind === "pdf_page"
        ? {
            kind: "pdf_page",
            page: segment.locator.page,
            excerpt,
          }
        : { kind: "text_range", start, end };
    }
    searchFrom = start + 1;
  }
  return null;
}

function assertReadableBoundedText(text: string): void {
  if (text.length > MAX_EXTRACTED_CHARACTERS) {
    throw new UnsupportedDocumentError(
      "Extracted text exceeds 2,000,000 characters.",
    );
  }
  if (!text.trim()) {
    throw new EmptyDocumentError(
      "No readable text was found in this document.",
    );
  }
}

function isPasswordProtectedPdfError(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === "object"
    && (
      (error as { name?: unknown }).name === "PasswordException"
      || (error as { code?: unknown }).code === 1
      || (error as { code?: unknown }).code === 2
    )
  );
}

function ensureMathSumPrecise(): void {
  const runtimeMath = Math as Math & {
    sumPrecise?: (values: Iterable<number>) => number;
  };
  if (runtimeMath.sumPrecise) return;
  Object.defineProperty(runtimeMath, "sumPrecise", {
    configurable: true,
    value(values: Iterable<number>) {
      let sum = 0;
      let compensation = 0;
      for (const value of values) {
        const adjusted = value - compensation;
        const next = sum + adjusted;
        compensation = next - sum - adjusted;
        sum = next;
      }
      return sum;
    },
    writable: true,
  });
}

function inspectDocxCentralDirectory(bytes: Uint8Array): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findSignatureFromEnd(
    view,
    ZIP_EOCD_SIGNATURE,
    ZIP_EOCD_MAX_SEARCH_BYTES,
  );
  if (eocd < 0 || eocd + 22 > bytes.byteLength) {
    throw new UnsupportedDocumentError("DOCX archive is malformed.");
  }
  const commentLength = view.getUint16(eocd + 20, true);
  if (eocd + 22 + commentLength !== bytes.byteLength) {
    throw new UnsupportedDocumentError("DOCX archive is malformed.");
  }
  const diskNumber = view.getUint16(eocd + 4, true);
  const centralDisk = view.getUint16(eocd + 6, true);
  const diskEntryCount = view.getUint16(eocd + 8, true);
  const entryCount = view.getUint16(eocd + 10, true);
  const centralSize = view.getUint32(eocd + 12, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  if (
    diskNumber !== 0
    || centralDisk !== 0
    || diskEntryCount !== entryCount
    || entryCount === 0xffff
    || centralSize === 0xffffffff
    || centralOffset === 0xffffffff
    || entryCount > MAX_DOCX_ENTRIES
  ) {
    throw new UnsupportedDocumentError(
      entryCount > MAX_DOCX_ENTRIES
        ? "DOCX archive exceeds supported limits."
        : "DOCX archive is malformed.",
    );
  }
  if (
    centralOffset > eocd
    || centralSize > eocd - centralOffset
    || centralOffset + centralSize !== eocd
  ) {
    throw new UnsupportedDocumentError("DOCX archive is malformed.");
  }

  let offset = centralOffset;
  let uncompressedBytes = 0;
  const names = new Set<string>();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (let index = 0; index < entryCount; index += 1) {
    if (
      offset < 0
      || offset + 46 > eocd
      || view.getUint32(offset, true) !== ZIP_CENTRAL_DIRECTORY_SIGNATURE
    ) {
      throw new UnsupportedDocumentError("DOCX archive is malformed.");
    }
    const compressedSize = view.getUint32(offset + 20, true);
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const entryCommentLength = view.getUint16(offset + 32, true);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    const nextOffset = nameEnd + extraLength + entryCommentLength;
    if (
      nameLength === 0
      || nameEnd > eocd
      || nextOffset > eocd
      || compressedSize === 0xffffffff
      || size === 0xffffffff
    ) {
      throw new UnsupportedDocumentError("DOCX archive is malformed.");
    }
    let name: string;
    try {
      name = decoder.decode(bytes.subarray(nameStart, nameEnd));
    } catch {
      throw new UnsupportedDocumentError("DOCX archive is malformed.");
    }
    if (
      name.startsWith("/")
      || name.split("/").some((part) => part === "..")
      || name.includes("\\")
    ) {
      throw new UnsupportedDocumentError(
        "DOCX archive contains an unsafe path.",
      );
    }
    if (names.has(name)) {
      throw new UnsupportedDocumentError("DOCX archive is malformed.");
    }
    names.add(name);
    uncompressedBytes += size;
    if (uncompressedBytes > MAX_DOCX_UNCOMPRESSED_BYTES) {
      throw new UnsupportedDocumentError(
        "DOCX archive exceeds 64 MiB expanded.",
      );
    }
    offset = nextOffset;
  }
  if (offset !== eocd) {
    throw new UnsupportedDocumentError("DOCX archive is malformed.");
  }
  if (
    !names.has("[Content_Types].xml")
    || !names.has("word/document.xml")
  ) {
    throw new UnsupportedDocumentError(
      "DOCX Office document parts are missing.",
    );
  }
}

function findSignatureFromEnd(
  view: DataView,
  signature: number,
  maxSearchBytes: number,
): number {
  if (view.byteLength < 22) return -1;
  const firstOffset = Math.max(0, view.byteLength - maxSearchBytes);
  for (
    let offset = view.byteLength - 22;
    offset >= firstOffset;
    offset -= 1
  ) {
    if (view.getUint32(offset, true) === signature) return offset;
  }
  return -1;
}

export async function processClaimedUpload(
  upload: ClaimedUploadedDocument,
  dependencies: {
    extract: (upload: ClaimedUploadedDocument) => Promise<ExtractionPreview>;
    savePreview: (input: { workspaceId: string; id: string; workerId: string; leaseToken: string; preview: ExtractionPreview }) => Promise<boolean>;
    createDeal?: () => Promise<void>;
    ingestXTrace?: () => Promise<void>;
  },
): Promise<UploadedDocumentRecord & { status: "awaiting_confirmation" }> {
  const preview = await dependencies.extract(upload);
  if (!await dependencies.savePreview({
    workspaceId: upload.workspaceId,
    id: upload.id,
    workerId: upload.workerId,
    leaseToken: upload.leaseToken,
    preview,
  })) {
    throw new Error("Upload claim was lost before its preview could be saved.");
  }
  return { ...upload, status: "awaiting_confirmation", extractionPreview: preview };
}

async function transcribeImage(input: {
  client: ClaudeClient;
  bytes: Uint8Array;
  contentType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
}): Promise<string> {
  const text = await input.client.complete({
    system: [
      "You transcribe images.",
      "Output only the text visible in the image exactly as written.",
      "Do not summarize, translate, comment, or add text.",
    ].join(" "),
    messages: [{
      role: "user",
      content: [
        {
          type: "image",
          source: {
            type: "base64",
            media_type: input.contentType,
            data: Buffer.from(input.bytes).toString("base64"),
          },
        },
        { type: "text", text: "Transcribe every visible word in this image verbatim." },
      ],
    }],
    maxTokens: 8_000,
  });
  if (!text.trim()) throw new EmptyDocumentError("No readable text was found in this document.");
  return text;
}

function imageContentType(
  contentType: string,
): "image/jpeg" | "image/png" | "image/gif" | "image/webp" {
  if (
    contentType === "image/jpeg"
    || contentType === "image/png"
    || contentType === "image/gif"
    || contentType === "image/webp"
  ) {
    return contentType;
  }
  throw new Error(`Unsupported runtime upload content type: ${contentType}`);
}

async function extractDealProfile(input: {
  client: ClaudeClient;
  documentText: string;
  filename: string;
}): Promise<{
  companyName: string | null;
  headline: string | null;
  facts: Array<Pick<
    ExtractionPreview["facts"][number],
    "text" | "excerpt" | "structured"
  >>;
}> {
  const response = await input.client.complete({
    system: [
      "You read a single venture pitch or company document and report what it says.",
      "Do not infer, estimate, or add anything the document does not state.",
      "Set structured to null for generic prose, PMF conclusions, or incomplete financial data; never infer product-market fit or calculate a financial value.",
      "Every excerpt must be an exact, character-for-character contiguous quote copied from the document text.",
      "Return JSON only, matching the requested schema.",
    ].join(" "),
    messages: [{
      role: "user",
      content: JSON.stringify({
        task: "Extract the company profile stated by this document.",
        outputSchema: {
          companyName: "the company or product name stated in the document, or null",
          headline: "one sentence describing what the company does, or null",
          facts: [{
            text: "one-sentence summary of the excerpt",
            excerpt: "exact quote copied from documentText, or null",
            structured: "null unless every field below is explicit in the excerpt; otherwise: " + JSON.stringify({
              field:
                "the explicit underwriting field named or unambiguously labeled by the excerpt",
              value:
                "the exact value text copied from the excerpt; never calculate, expand abbreviations, or infer",
              unit: "the explicit unit, or null",
              currency: "the explicit ISO currency code, or null",
              periodStart: "explicit YYYY-MM-DD period start, or null",
              periodEnd: "explicit YYYY-MM-DD period end, or null",
              publishedAt: "explicit ISO date-time with offset, or null",
              eventAt: "explicit ISO date-time with offset, or null",
            }),
          }],
        },
        filename: input.filename,
        documentText: input.documentText,
      }),
    }],
    maxTokens: 3_000,
  });
  const parsed = ExtractionSchema.parse(parseJson(response));
  return {
    companyName: parsed.companyName?.trim() || null,
    headline: parsed.headline?.trim() || null,
    facts: parsed.facts.map((fact) => ({
      text: fact.text.trim(),
      excerpt: fact.excerpt?.trim() ? fact.excerpt : null,
      structured: fact.structured
        ? {
            ...fact.structured,
            field: fact.structured.field.trim(),
            value: fact.structured.value.trim(),
            unit: fact.structured.unit?.trim() || null,
          }
        : null,
    })),
  };
}

function parseJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return JSON.parse(fenced?.[1] ?? trimmed);
}
