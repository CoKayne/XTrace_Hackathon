export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

export const DOCX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export const RUNTIME_UPLOAD_CONTENT_TYPES = [
  "text/plain",
  "text/markdown",
  "application/pdf",
  DOCX_CONTENT_TYPE,
  "image/png",
  "image/webp",
] as const;

export type RuntimeUploadContentType = typeof RUNTIME_UPLOAD_CONTENT_TYPES[number];

const EXTENSION_CONTENT_TYPES = {
  txt: "text/plain",
  md: "text/markdown",
  pdf: "application/pdf",
  docx: DOCX_CONTENT_TYPE,
  png: "image/png",
  webp: "image/webp",
} as const;

export class UnsupportedUploadError extends Error {
  readonly code = "UNSUPPORTED_MEDIA_TYPE";
}

export function resolveRuntimeUploadContentType(input: {
  filename: string;
  reportedType?: string;
}): RuntimeUploadContentType {
  const extension = input.filename.split(".").pop()?.toLowerCase() ?? "";
  const resolved = Object.hasOwn(EXTENSION_CONTENT_TYPES, extension)
    ? EXTENSION_CONTENT_TYPES[extension as keyof typeof EXTENSION_CONTENT_TYPES]
    : undefined;
  if (!resolved) {
    throw new UnsupportedUploadError(
      "Upload a TXT, Markdown, PDF, DOCX, PNG, or WebP file.",
    );
  }
  if (
    input.reportedType?.trim()
    && input.reportedType !== "application/octet-stream"
    && input.reportedType !== resolved
  ) {
    throw new UnsupportedUploadError(
      "The uploaded file type does not match its filename extension.",
    );
  }
  return resolved;
}

export function uploadedObjectKey(input: {
  workspaceId: string;
  uploadId: string;
  filename: string;
}): string {
  return `private/workspaces/${input.workspaceId}/uploads/${input.uploadId}/${safeFilename(input.filename)}`;
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

export function uploadedDocumentId(input: { workspaceId: string; checksum: string }): string {
  return `upload_${input.checksum}`;
}
