import assert from "node:assert/strict";
import test from "node:test";

import { POST as uploadDocument } from "../../app/api/uploads/route";
import {
  createMemoryUploadedDocumentsRepository,
  type ExtractionPreview,
} from "../../db/repositories/uploaded-documents";
import type { AuthorizedRequestContext } from "../../lib/auth/request-context";
import { processClaimedUpload } from "../../worker/extract-upload";

test("extraction stops at confirmation preview without Deal or XTrace side effects", async () => {
  const effects: string[] = [];
  const result = await processClaimedUpload(uploadFixture(), {
    extract: async () => previewFixture(),
    savePreview: async () => {
      effects.push("preview");
      return true;
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

test("invalid upload signatures or reported types never reach storage or create a staged document", async () => {
  for (const [filename, contentType, bytes] of [
    ["deck.pdf", "application/pdf", new Uint8Array([0x25, 0x50, 0x44, 0x46])],
    ["deck.pdf", "image/jpeg", new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])],
    ["deck.pdf", "audio/mpeg", new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])],
    ["deck.pdf", "video/mp4", new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])],
    ["chart.png", "image/png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a])],
    ["chart.webp", "image/webp", new TextEncoder().encode("RIFF0000NOPE")],
    ["memo.docx", "application/octet-stream", new Uint8Array([0x50, 0x4b, 0x03, 0x05])],
    ["memo.txt", "text/plain", new Uint8Array([0xc3, 0x28])],
  ] as const) {
    const repository = createMemoryUploadedDocumentsRepository();
    const stored: string[] = [];
    const form = new FormData();
    form.set("file", new File([bytes], filename, { type: contentType }));

    const response = await uploadDocument(
      new Request("https://vsee.test/api/uploads", {
        method: "POST",
        headers: { "cf-connecting-ip": `198.51.100.${stored.length + 1}` },
        body: form,
      }),
      undefined,
      {
        async resolveRequestContext() {
          return uploadContext();
        },
        uploadedDocuments: repository,
        privateObjectStorage: {
          async ensurePrivateObject(input) {
            stored.push(input.key);
            return { value: { key: input.key }, created: true };
          },
          async readPrivateObject() {
            return null;
          },
        },
      },
    );

    assert.equal(response.status, 415, filename);
    assert.deepEqual(stored, [], filename);
    assert.deepEqual(await repository.list("workspace_upload_test"), [], filename);
  }
});

function uploadContext(): AuthorizedRequestContext {
  return {
    mode: "public_sandbox",
    principal: {
      userId: "system:public-sandbox",
      email: "public-sandbox@invalid.local",
    },
    workspaceId: "workspace_upload_test",
    role: "sandbox",
    permissions: {
      readWorkspace: true,
      readPrivateSources: true,
      mutateSources: true,
      managePolicy: true,
      administerFrameworks: false,
    },
  };
}

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
    workerId: "worker-a",
    leaseToken: "lease-a",
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
