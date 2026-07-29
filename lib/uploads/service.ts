import type { UploadableContentType } from "../storage/service";

export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

const EXTENSION_CONTENT_TYPES: Record<string, UploadableContentType> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
  md: "text/markdown",
};

export class UnsupportedUploadError extends Error {
  readonly code = "UNSUPPORTED_MEDIA_TYPE";
}

// The browser's reported MIME type is unreliable (Windows sends
// application/octet-stream for .docx), so the filename extension decides and
// the reported type only has to agree when it is one we recognize.
export function resolveUploadContentType(input: {
  filename: string;
  reportedType?: string;
}): UploadableContentType {
  const extension = input.filename.split(".").pop()?.toLowerCase() ?? "";
  const resolved = EXTENSION_CONTENT_TYPES[extension];
  if (!resolved) {
    throw new UnsupportedUploadError(
      "Upload a PDF, DOCX, TXT, or MD file.",
    );
  }
  return resolved;
}

export function uploadedObjectKey(input: {
  checksum: string;
  filename: string;
}): string {
  return `private/uploads/${input.checksum}/${safeFilename(input.filename)}`;
}

export function safeFilename(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? "upload";
  const cleaned = base.replace(/[^\w.\-]+/g, "_").replace(/^\.+/, "");
  return cleaned.slice(0, 120) || "upload";
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const view = new Uint8Array(bytes.byteLength);
  view.set(bytes);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", view.buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function uploadedDocumentId(checksum: string): string {
  return `upload_${checksum.slice(0, 20)}`;
}

export function uploadedDealId(checksum: string): string {
  return `deal_upload_${checksum.slice(0, 20)}`;
}
