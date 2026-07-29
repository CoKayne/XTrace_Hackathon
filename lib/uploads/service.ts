export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

export const RUNTIME_UPLOAD_CONTENT_TYPES = [
  "text/plain",
  "text/markdown",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
] as const;

export type RuntimeUploadContentType = typeof RUNTIME_UPLOAD_CONTENT_TYPES[number];

const EXTENSION_CONTENT_TYPES: Record<string, RuntimeUploadContentType> = {
  txt: "text/plain",
  md: "text/markdown",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
};

export class UnsupportedUploadError extends Error {
  readonly code = "UNSUPPORTED_MEDIA_TYPE";
}

// The browser's reported MIME type is unreliable (Windows sends
// application/octet-stream for .docx), so the filename extension decides and
// the reported type only has to agree when it is one we recognize.
export function resolveRuntimeUploadContentType(input: {
  filename: string;
  reportedType?: string;
}): RuntimeUploadContentType {
  const extension = input.filename.split(".").pop()?.toLowerCase() ?? "";
  const resolved = EXTENSION_CONTENT_TYPES[extension];
  if (!resolved) {
    throw new UnsupportedUploadError(
      "Upload a TXT, Markdown, JPEG, PNG, GIF, or WebP file.",
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

export function uploadedDocumentId(checksum: string): string {
  return `upload_${checksum.slice(0, 20)}`;
}
