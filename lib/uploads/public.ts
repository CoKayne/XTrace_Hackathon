import type {
  ExtractionPreview,
  UploadedDocumentRecord,
} from "../../db/repositories/uploaded-documents";

export type PublicUploadedDocumentRecord = {
  id: string;
  filename: string;
  contentType: string;
  byteSize: number;
  status: UploadedDocumentRecord["status"];
  failureReason: string | null;
  extractionPreview: PublicExtractionPreview | null;
  createdAt: string;
  updatedAt: string;
};

export interface PublicExtractionPreview {
  candidateCompanyName: string | null;
  candidateHeadline: string | null;
  facts: ExtractionPreview["facts"];
}

export function toPublicUploadedDocument(
  record: UploadedDocumentRecord,
): PublicUploadedDocumentRecord {
  return {
    id: record.id,
    filename: record.filename,
    contentType: record.contentType,
    byteSize: record.byteSize,
    status: record.status,
    failureReason: record.failureReason ? "Document processing failed." : null,
    extractionPreview: record.extractionPreview
      ? {
          candidateCompanyName: record.extractionPreview.candidateCompanyName,
          candidateHeadline: record.extractionPreview.candidateHeadline,
          facts: structuredClone(record.extractionPreview.facts),
        }
      : null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}
