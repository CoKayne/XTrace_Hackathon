import type { UploadedDocumentRecord } from "../../db/repositories/uploaded-documents";

export type PublicUploadedDocumentRecord = Omit<
  UploadedDocumentRecord,
  "objectKey"
>;

export function toPublicUploadedDocument(
  record: UploadedDocumentRecord,
): PublicUploadedDocumentRecord {
  return {
    id: record.id,
    workspaceId: record.workspaceId,
    filename: record.filename,
    contentType: record.contentType,
    byteSize: record.byteSize,
    checksum: record.checksum,
    status: record.status,
    failureReason: record.failureReason ? "Document processing failed." : null,
    extractionPreview: record.extractionPreview,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}
