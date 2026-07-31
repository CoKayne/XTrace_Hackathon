import {
  type RuntimeUploadContentType,
  UnsupportedUploadError,
} from "./service";

const PDF_SIGNATURE = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
const PNG_SIGNATURE = new Uint8Array([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
]);
const ZIP_LOCAL_FILE_SIGNATURE = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
const RIFF_SIGNATURE = new Uint8Array([0x52, 0x49, 0x46, 0x46]);
const WEBP_SIGNATURE = new Uint8Array([0x57, 0x45, 0x42, 0x50]);

export function validateUploadBytes(input: {
  filename: string;
  contentType: RuntimeUploadContentType;
  bytes: Uint8Array;
}): void {
  switch (input.contentType) {
    case "text/plain":
    case "text/markdown":
      validateTextBytes(input.bytes);
      return;
    case "application/pdf":
      validateSignature(input.bytes, PDF_SIGNATURE);
      return;
    case "image/png":
      validateSignature(input.bytes, PNG_SIGNATURE);
      return;
    case "image/webp":
      if (
        input.bytes.byteLength < 12
        || !hasSignature(input.bytes, RIFF_SIGNATURE)
        || !hasSignature(input.bytes, WEBP_SIGNATURE, 8)
      ) invalidBytes();
      return;
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      validateSignature(input.bytes, ZIP_LOCAL_FILE_SIGNATURE);
      return;
  }
}

function validateTextBytes(bytes: Uint8Array): void {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    invalidBytes();
  }
  if (!text!.trim()) invalidBytes();
}

function validateSignature(
  bytes: Uint8Array,
  signature: Uint8Array,
): void {
  if (!hasSignature(bytes, signature)) invalidBytes();
}

function hasSignature(
  bytes: Uint8Array,
  signature: Uint8Array,
  offset = 0,
): boolean {
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

function invalidBytes(): never {
  throw new UnsupportedUploadError("The uploaded file bytes are invalid.");
}
