import { z } from "zod";

import type {
  ClaimedUploadedDocument,
  ExtractionPreview,
  UploadedDocumentRecord,
} from "../db/repositories/uploaded-documents";
import type { ClaudeClient } from "../lib/claude/client";
import { sha256Hex } from "../lib/uploads/service";

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
}

export async function extractDocumentText(input: {
  bytes: Uint8Array;
  contentType: string;
  filename: string;
  client?: ClaudeClient;
}): Promise<string> {
  if (input.contentType === "text/plain" || input.contentType === "text/markdown") {
    const text = new TextDecoder().decode(input.bytes);
    if (text.trim()) return text;
    throw new EmptyDocumentError("No readable text was found in this document.");
  }
  if (!input.client) {
    throw new Error("Image extraction requires an Anthropic client.");
  }
  return transcribeImage({
    client: input.client,
    bytes: input.bytes,
    contentType: imageContentType(input.contentType),
  });
}

export async function extractUploadPreview(input: {
  record: UploadedDocumentRecord;
  bytes: Uint8Array;
  client: ClaudeClient;
  extractedAt?: string;
}): Promise<ExtractionPreview> {
  const documentText = await extractDocumentText({
    bytes: input.bytes,
    contentType: input.record.contentType,
    filename: input.record.filename,
    client: input.client,
  });
  const profile = await extractDealProfile({
    client: input.client,
    documentText,
    filename: input.record.filename,
  });
  const isImage = input.record.contentType.startsWith("image/");
  const facts: ExtractionPreview["facts"] = [];
  for (const fact of profile.facts) {
    if (isImage) {
      facts.push({
        text: fact.text,
        excerpt: null,
        locator: { kind: "image", imageIndex: 0 },
        ...(fact.structured ? { structured: fact.structured } : {}),
      });
      continue;
    }
    if (!fact.excerpt) continue;
    const start = documentText.indexOf(fact.excerpt);
    if (start < 0) continue;
    facts.push({
      text: fact.text,
      excerpt: fact.excerpt,
      locator: { kind: "text_range", start, end: start + fact.excerpt.length },
      ...(fact.structured ? { structured: fact.structured } : {}),
    });
  }
  return {
    candidateCompanyName: profile.companyName,
    candidateHeadline: profile.headline,
    facts,
    extractionMetadata: {
      extractorId: isImage ? "claude_vision_v1" : "plain_text_v1",
      extractorVersion: "1",
      extractedAt: input.extractedAt ?? new Date().toISOString(),
      contentHash: await sha256Hex(input.bytes),
      inputBytes: input.bytes.byteLength,
      extractedCharacters: documentText.length,
      truncated: false,
    },
  };
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
      excerpt: fact.excerpt?.trim() || null,
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
