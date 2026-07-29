import assert from "node:assert/strict";
import test from "node:test";

import {
  createMemoryUploadedDocumentsRepository,
  type ExtractionPreview,
} from "../../db/repositories/uploaded-documents";
import {
  resolveRuntimeUploadContentType,
  safeFilename,
  uploadedObjectKey,
} from "../../lib/uploads/service";
import {
  extractDocumentText,
  extractUploadPreview,
} from "../../worker/extract-upload";

const RECORD = {
  id: "upload_abc",
  workspaceId: "workspace_demo",
  filename: "acme.txt",
  contentType: "text/plain",
  byteSize: 1_024,
  checksum: "abc123",
  objectKey: "private/workspaces/workspace_demo/uploads/upload_abc/acme.txt",
  status: "extracting" as const,
  failureReason: null,
  extractionPreview: null,
  createdAt: "2026-07-25T12:00:00.000Z",
  updatedAt: "2026-07-25T12:00:00.000Z",
};

for (const [filename, expected] of [
  ["notes.txt", "text/plain"],
  ["notes.md", "text/markdown"],
  ["slide.jpg", "image/jpeg"],
  ["slide.png", "image/png"],
  ["slide.gif", "image/gif"],
  ["slide.webp", "image/webp"],
] as const) {
  test(`accepts ${filename}`, () => {
    assert.equal(resolveRuntimeUploadContentType({ filename }), expected);
  });
}

for (const filename of ["deck.pdf", "memo.docx", "call.m4a"]) {
  test(`rejects ${filename}`, () => {
    assert.throws(() => resolveRuntimeUploadContentType({ filename }));
  });
}

test("upload filenames and object keys cannot escape their workspace upload prefix", () => {
  assert.equal(safeFilename("../../etc/passwd"), "passwd");
  assert.equal(safeFilename("a b/c:d.png"), "c_d.png");
  assert.equal(
    uploadedObjectKey({
      workspaceId: "workspace_demo",
      uploadId: "upload_abc",
      filename: "../evil.png",
    }),
    "private/workspaces/workspace_demo/uploads/upload_abc/evil.png",
  );
});

test("text extraction preserves the complete deterministically decoded document", async () => {
  const documentText = `Acme builds realtime logistics software.\n${"x".repeat(40_001)}`;
  const text = await extractDocumentText({
    bytes: new TextEncoder().encode(documentText),
    contentType: "text/plain",
    filename: "acme.txt",
  });

  assert.equal(text, documentText);
});

test("image extraction sends the source bytes as an Anthropic image block", async () => {
  let messageContent: unknown;
  const text = await extractDocumentText({
    bytes: new Uint8Array([137, 80, 78, 71]),
    contentType: "image/png",
    filename: "slide.png",
    client: {
      async complete(input) {
        messageContent = input.messages[0]?.content;
        return "Acme serves 240 carriers.";
      },
    },
  });

  assert.equal(text, "Acme serves 240 carriers.");
  assert.deepEqual(messageContent, [
    {
      type: "image",
      source: {
        type: "base64",
        media_type: "image/png",
        data: "iVBORw==",
      },
    },
    { type: "text", text: "Transcribe every visible word in this image verbatim." },
  ]);
});

test("preview facts retain locators and complete extraction metadata", async () => {
  const documentText = "Acme serves 240 carriers. Revenue grew to $4.2M in 2025.";
  const preview = await extractUploadPreview({
    record: RECORD,
    bytes: new TextEncoder().encode(documentText),
    client: {
      async complete() {
        return JSON.stringify({
          companyName: "Acme",
          headline: "Acme serves 240 carriers.",
          facts: [{ text: "Customer base", excerpt: "Acme serves 240 carriers." }],
        });
      },
    },
    extractedAt: "2026-07-25T12:00:00.000Z",
  });

  assert.deepEqual(preview.facts, [{
    text: "Customer base",
    excerpt: "Acme serves 240 carriers.",
    locator: { kind: "text_range", start: 0, end: 25 },
  }]);
  assert.deepEqual(preview.extractionMetadata, {
    extractorId: "plain_text_v1",
    extractorVersion: "1",
    extractedAt: "2026-07-25T12:00:00.000Z",
    contentHash: await sha256("Acme serves 240 carriers. Revenue grew to $4.2M in 2025."),
    inputBytes: documentText.length,
    extractedCharacters: documentText.length,
    truncated: false,
  });
});

test("image preview facts never persist a model quote as a verbatim excerpt", async () => {
  let calls = 0;
  const preview = await extractUploadPreview({
    record: { ...RECORD, filename: "slide.png", contentType: "image/png" },
    bytes: new Uint8Array([137, 80, 78, 71]),
    client: {
      async complete() {
        calls += 1;
        if (calls === 1) return "Acme serves 240 carriers.";
        return JSON.stringify({
          companyName: "Acme",
          headline: "Acme serves carriers.",
          facts: [{ text: "Funding", excerpt: "Acme raised $30M." }],
        });
      },
    },
  });

  assert.deepEqual(preview.facts, [{
    text: "Funding",
    excerpt: null,
    locator: { kind: "image", imageIndex: 0 },
  }]);
});

test("an empty text document fails honestly", async () => {
  await assert.rejects(
    extractDocumentText({
      bytes: new TextEncoder().encode("  \n "),
      contentType: "text/plain",
      filename: "blank.txt",
    }),
    /No readable text/,
  );
});

test("claiming an upload is exclusive until its lease expires and saves a preview", async () => {
  let clock = Date.parse("2026-07-25T12:00:00.000Z");
  const repository = createMemoryUploadedDocumentsRepository({
    now: () => new Date(clock),
  });
  await repository.create({
    id: "upload_1",
    workspaceId: "workspace_demo",
    filename: "a.txt",
    contentType: "text/plain",
    byteSize: 10,
    checksum: "sum1",
    objectKey: "private/workspaces/workspace_demo/uploads/upload_1/a.txt",
  });

  assert.equal((await repository.claimNext("worker-a"))?.id, "upload_1");
  assert.equal(await repository.claimNext("worker-b"), null);

  clock += 6 * 60_000;
  assert.equal(
    (await repository.claimNext("worker-b"))?.id,
    "upload_1",
    "an expired lease must be reclaimable after a worker crash",
  );

  const preview = previewFixture();
  assert.equal(await repository.savePreview({
    workspaceId: "workspace_demo",
    id: "upload_1",
    workerId: "worker-b",
    preview,
  }), true);
  const [record] = await repository.list("workspace_demo");
  assert.equal(record?.status, "awaiting_confirmation");
  assert.deepEqual(record?.extractionPreview, preview);
  assert.equal(await repository.claimNext("worker-c"), null);
});

test("same upload bytes coexist across workspaces and mutations require the current owner", async () => {
  let clock = Date.parse("2026-07-25T12:00:00.000Z");
  const repository = createMemoryUploadedDocumentsRepository({ now: () => new Date(clock) });
  const checksum = "same-bytes";
  await repository.create({
    id: "upload_workspace_a_same-bytes",
    workspaceId: "workspace_a",
    filename: "a.txt",
    contentType: "text/plain",
    byteSize: 10,
    checksum,
    objectKey: "private/workspaces/workspace_a/uploads/upload_workspace_a_same-bytes/a.txt",
  });
  await repository.create({
    id: "upload_workspace_b_same-bytes",
    workspaceId: "workspace_b",
    filename: "b.txt",
    contentType: "text/plain",
    byteSize: 10,
    checksum,
    objectKey: "private/workspaces/workspace_b/uploads/upload_workspace_b_same-bytes/b.txt",
  });

  assert.equal((await repository.list("workspace_a")).length, 1);
  assert.equal((await repository.list("workspace_b")).length, 1);
  assert.equal(await repository.get({ workspaceId: "workspace_b", id: "upload_workspace_a_same-bytes" }), null);

  const firstClaim = await repository.claimNext("worker-a");
  assert.equal(firstClaim?.workspaceId, "workspace_a");
  clock += 6 * 60_000;
  const secondClaim = await repository.claimNext("worker-b");
  assert.equal(secondClaim?.id, firstClaim?.id);
  assert.equal(await repository.savePreview({
    workspaceId: "workspace_a",
    id: firstClaim!.id,
    workerId: "worker-a",
    preview: previewFixture(),
  }), false);
  assert.equal(await repository.fail({
    workspaceId: "workspace_a",
    id: firstClaim!.id,
    workerId: "worker-a",
    reason: "late failure",
  }), false);
  assert.equal(await repository.savePreview({
    workspaceId: "workspace_a",
    id: firstClaim!.id,
    workerId: "worker-b",
    preview: previewFixture(),
  }), true);
  await repository.deleteAll("workspace_a");
  assert.equal(await repository.savePreview({
    workspaceId: "workspace_a",
    id: firstClaim!.id,
    workerId: "worker-b",
    preview: previewFixture(),
  }), false);
});

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

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
