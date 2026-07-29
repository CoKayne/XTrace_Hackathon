import assert from "node:assert/strict";
import test from "node:test";

import type { ExtractionPreview } from "../../db/repositories/uploaded-documents";
import { processClaimedUpload } from "../../worker/extract-upload";

test("extraction stops at confirmation preview without Deal or XTrace side effects", async () => {
  const effects: string[] = [];
  const result = await processClaimedUpload(uploadFixture(), {
    extract: async () => previewFixture(),
    savePreview: async () => {
      effects.push("preview");
    },
    createDeal: async () => {
      effects.push("deal");
    },
    ingestXTrace: async () => {
      effects.push("xtrace");
    },
  });
  assert.equal(result.status, "awaiting_confirmation");
  assert.deepEqual(effects, ["preview"]);
});

function uploadFixture() {
  return {
    id: "upload_1",
    workspaceId: "workspace_demo",
    filename: "acme.txt",
    contentType: "text/plain",
    byteSize: 10,
    checksum: "checksum",
    objectKey: "private/workspaces/workspace_demo/uploads/upload_1/acme.txt",
    status: "extracting" as const,
    failureReason: null,
    extractionPreview: null,
    createdAt: "2026-07-25T12:00:00.000Z",
    updatedAt: "2026-07-25T12:00:00.000Z",
  };
}

function previewFixture(): ExtractionPreview {
  return {
    candidateCompanyName: "Acme",
    candidateHeadline: "Acme serves carriers.",
    facts: [],
    extractionMetadata: {
      extractorId: "plain_text_v1",
      extractorVersion: "1",
      extractedAt: "2026-07-25T12:00:00.000Z",
      contentHash: "abc",
      inputBytes: 10,
      extractedCharacters: 10,
      truncated: false,
    },
  };
}
