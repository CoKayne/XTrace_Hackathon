import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createMemoryUploadedDocumentsRepository,
  createSupabaseUploadedDocumentsRepository,
  type ExtractionPreview,
} from "../../db/repositories/uploaded-documents";
import {
  DOCX_CONTENT_TYPE,
  resolveRuntimeUploadContentType,
  safeFilename,
  uploadedObjectKey,
} from "../../lib/uploads/service";
import { validateUploadBytes } from "../../lib/uploads/file-validation";
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

for (const [filename, reportedType, expected] of [
  ["memo.txt", "text/plain", "text/plain"],
  ["notes.md", "text/markdown", "text/markdown"],
  ["deck.pdf", "application/pdf", "application/pdf"],
  ["memo.docx", "application/octet-stream", DOCX_CONTENT_TYPE],
  ["chart.png", "image/png", "image/png"],
  ["chart.webp", "image/webp", "image/webp"],
] as const) {
  test(`accepts ${filename}`, () => {
    assert.equal(
      resolveRuntimeUploadContentType({ filename, reportedType }),
      expected,
    );
  });
}

for (const filename of [
  "photo.jpg",
  "photo.jpeg",
  "animation.gif",
  "legacy.doc",
  "meeting.m4a",
  "clip.mp4",
]) {
  test(`rejects ${filename}`, () => {
    assert.throws(() => resolveRuntimeUploadContentType({ filename }));
  });
}

for (const reportedType of [
  "image/png",
  "image/jpeg",
  "audio/mpeg",
  "video/mp4",
  "application/pdf; charset=binary",
]) {
  test(`rejects a PDF filename with contradictory reported MIME type ${reportedType}`, () => {
    assert.throws(() => resolveRuntimeUploadContentType({
      filename: "deck.pdf",
      reportedType,
    }));
  });
}

for (const reportedType of [undefined, "", "   ", "application/octet-stream"]) {
  test(`accepts PDF with ${reportedType || "no"} reported MIME type`, () => {
    assert.equal(
      resolveRuntimeUploadContentType({ filename: "deck.pdf", reportedType }),
      "application/pdf",
    );
  });
}

test("rejects malformed signatures and invalid UTF-8 upload bytes", () => {
  for (const [filename, contentType, bytes] of [
    ["deck.pdf", "application/pdf", new Uint8Array([0x25, 0x50, 0x44, 0x46])],
    ["chart.png", "image/png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a])],
    ["chart.webp", "image/webp", new TextEncoder().encode("RIFF0000NOPE")],
    ["memo.docx", DOCX_CONTENT_TYPE, new Uint8Array([0x50, 0x4b, 0x03, 0x05])],
    ["memo.txt", "text/plain", new Uint8Array([0xc3, 0x28])],
    ["notes.md", "text/markdown", new TextEncoder().encode(" \n\t ")],
  ] as const) {
    assert.throws(() => validateUploadBytes({ filename, contentType, bytes }));
  }
});

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

test("PDF extraction maps an exact second-page excerpt to page 2 without truncation", async () => {
  const bytes = await uploadFixture("two-page-text.pdf");
  const excerpt =
    "Second-page evidence: Acme signed three enterprise customers.";
  const preview = await extractUploadPreview({
    record: {
      ...RECORD,
      filename: "two-page-text.pdf",
      contentType: "application/pdf",
      byteSize: bytes.byteLength,
    },
    bytes,
    client: {
      async complete(input) {
        const request = JSON.parse(
          String(input.messages[0]?.content),
        ) as { documentText: string };
        assert.equal(
          request.documentText,
          "First-page context: Acme prepares an enterprise update."
            + "\n\n"
            + excerpt,
        );
        return JSON.stringify({
          companyName: "Acme",
          headline: null,
          facts: [{ text: "Enterprise traction", excerpt }],
        });
      },
    },
    extractedAt: "2026-07-30T12:00:00.000Z",
  });

  assert.deepEqual(
    preview.facts.find((fact) => fact.excerpt?.startsWith("Second-page"))
      ?.locator,
    {
      kind: "pdf_page",
      page: 2,
      excerpt,
    },
  );
  assert.equal(preview.extractionMetadata.extractorId, "pdf_text_v1");
  assert.equal(preview.extractionMetadata.truncated, false);
});

test("PDF extraction drops an exact occurrence that crosses page segments", async () => {
  const bytes = await uploadFixture("two-page-text.pdf");
  const preview = await extractUploadPreview({
    record: {
      ...RECORD,
      filename: "two-page-text.pdf",
      contentType: "application/pdf",
      byteSize: bytes.byteLength,
    },
    bytes,
    client: {
      async complete() {
        return JSON.stringify({
          companyName: "Acme",
          headline: null,
          facts: [{
            text: "Cross-page synthesis",
            excerpt:
              "Acme prepares an enterprise update.\n\nSecond-page evidence",
          }],
        });
      },
    },
  });

  assert.deepEqual(preview.facts, []);
});

test("DOCX extraction preserves exact text-range lineage", async () => {
  const bytes = await uploadFixture("sample-memo.docx");
  const excerpt =
    "Acme reported annual recurring revenue of USD 2 million.";
  const preview = await extractUploadPreview({
    record: {
      ...RECORD,
      filename: "sample-memo.docx",
      contentType: DOCX_CONTENT_TYPE,
      byteSize: bytes.byteLength,
    },
    bytes,
    client: {
      async complete() {
        return JSON.stringify({
          companyName: "Acme",
          headline: null,
          facts: [{ text: "Reported ARR", excerpt }],
        });
      },
    },
  });

  assert.deepEqual(preview.facts, [{
    text: "Reported ARR",
    excerpt,
    locator: { kind: "text_range", start: 0, end: excerpt.length },
  }]);
  assert.equal(preview.extractionMetadata.extractorId, "docx_text_v1");
  assert.equal(preview.extractionMetadata.truncated, false);
});

test("textless PDFs fail without invoking a vision fallback", async () => {
  let modelCalls = 0;
  await assert.rejects(
    extractDocumentText({
      bytes: await uploadFixture("textless.pdf"),
      contentType: "application/pdf",
      filename: "scan.pdf",
      client: {
        async complete() {
          modelCalls += 1;
          return "model-derived text";
        },
      },
    }),
    { message: "No readable text was found in this document." },
  );
  assert.equal(modelCalls, 0);
});

test("malformed DOCX archives fail with a fixed non-secret reason", async () => {
  await assert.rejects(
    extractDocumentText({
      bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00]),
      contentType: DOCX_CONTENT_TYPE,
      filename: "malformed.docx",
    }),
    { message: "DOCX archive is malformed." },
  );
});

test("password-protected PDFs fail with a fixed non-secret reason", async () => {
  await assert.rejects(
    extractDocumentText({
      bytes: await uploadFixture("password-protected.pdf"),
      contentType: "application/pdf",
      filename: "protected.pdf",
    }),
    { message: "Password-protected PDFs are not supported." },
  );
});

test("PDFs over 100 pages fail before returning partial text", async () => {
  await assert.rejects(
    extractDocumentText({
      bytes: await uploadFixture("over-100-pages.pdf"),
      contentType: "application/pdf",
      filename: "too-many-pages.pdf",
    }),
    { message: "PDF exceeds 100 pages." },
  );
});

test("extracted text over 2,000,000 characters fails instead of truncating", async () => {
  await assert.rejects(
    extractDocumentText({
      bytes: await uploadFixture("oversized-text.docx"),
      contentType: DOCX_CONTENT_TYPE,
      filename: "too-much-text.docx",
    }),
    { message: "Extracted text exceeds 2,000,000 characters." },
  );
});

test("DOCX central-directory limits reject unsafe paths and expansion claims", async () => {
  const fixture = await uploadFixture("sample-memo.docx");
  const cases = [
    {
      label: "entry count",
      bytes: mutateDocx(fixture, ({ view, eocd }) => {
        view.setUint16(eocd + 8, 2_001, true);
        view.setUint16(eocd + 10, 2_001, true);
      }),
      message: "DOCX archive exceeds supported limits.",
    },
    {
      label: "unsafe path",
      bytes: mutateDocx(fixture, ({ bytes, centralEntries }) => {
        replaceCentralEntryName(
          bytes,
          centralEntries.get("word/document.xml")!,
          "../d/document.xml",
        );
      }),
      message: "DOCX archive contains an unsafe path.",
    },
    {
      label: "expanded size",
      bytes: mutateDocx(fixture, ({ view, centralEntries }) => {
        view.setUint32(
          centralEntries.get("word/document.xml")! + 24,
          64 * 1024 * 1024 + 1,
          true,
        );
      }),
      message: "DOCX archive exceeds 64 MiB expanded.",
    },
    {
      label: "required parts",
      bytes: mutateDocx(fixture, ({ bytes, centralEntries }) => {
        replaceCentralEntryName(
          bytes,
          centralEntries.get("word/document.xml")!,
          "word/notument.xml",
        );
      }),
      message: "DOCX Office document parts are missing.",
    },
  ];

  for (const boundary of cases) {
    await assert.rejects(
      extractDocumentText({
        bytes: boundary.bytes,
        contentType: DOCX_CONTENT_TYPE,
        filename: `${boundary.label}.docx`,
      }),
      { message: boundary.message },
      boundary.label,
    );
  }
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

test("preview preserves only explicitly extracted structured underwriting fields", async () => {
  const documentText = "ARR was $2,000,000 for calendar 2025.";
  const preview = await extractUploadPreview({
    record: RECORD,
    bytes: new TextEncoder().encode(documentText),
    client: {
      async complete() {
        return JSON.stringify({
          companyName: "Acme",
          headline: null,
          facts: [{
            text: "ARR was $2,000,000 for calendar 2025.",
            excerpt: "ARR was $2,000,000 for calendar 2025.",
            structured: {
              field: "ARR",
              value: "$2,000,000",
              unit: "currency",
              currency: "USD",
              periodStart: "2025-01-01",
              periodEnd: "2025-12-31",
              publishedAt: null,
              eventAt: null,
            },
          }],
        });
      },
    },
  });

  assert.deepEqual(preview.facts[0]?.structured, {
    field: "ARR",
    value: "$2,000,000",
    unit: "currency",
    currency: "USD",
    periodStart: "2025-01-01",
    periodEnd: "2025-12-31",
    publishedAt: null,
    eventAt: null,
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
  const reclaimed = await repository.claimNext("worker-b");
  assert.equal(
    reclaimed?.id,
    "upload_1",
    "an expired lease must be reclaimable after a worker crash",
  );

  const preview = previewFixture();
  assert.equal(await repository.savePreview({
    workspaceId: "workspace_demo",
    id: "upload_1",
    workerId: "worker-b",
    leaseToken: reclaimed!.leaseToken,
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
    leaseToken: firstClaim!.leaseToken,
    preview: previewFixture(),
  }), false);
  assert.equal(await repository.fail({
    workspaceId: "workspace_a",
    id: firstClaim!.id,
    workerId: "worker-a",
    leaseToken: firstClaim!.leaseToken,
    reason: "late failure",
  }), false);
  assert.equal(await repository.savePreview({
    workspaceId: "workspace_a",
    id: firstClaim!.id,
    workerId: "worker-b",
    leaseToken: secondClaim!.leaseToken,
    preview: previewFixture(),
  }), true);
  await repository.deleteAll("workspace_a");
  assert.equal(await repository.savePreview({
    workspaceId: "workspace_a",
    id: firstClaim!.id,
    workerId: "worker-b",
    leaseToken: secondClaim!.leaseToken,
    preview: previewFixture(),
  }), false);
});

test("Supabase claims an expired upload immediately after expiry but not before", async () => {
  const expiredAt = "2026-07-25T12:00:00.000Z";
  const record = {
    id: "upload_1",
    workspace_id: "workspace_demo",
    filename: "a.txt",
    content_type: "text/plain",
    byte_size: 10,
    checksum: "sum1",
    object_key: "private/workspaces/workspace_demo/uploads/upload_1/a.txt",
    status: "extracting",
    failure_reason: null,
    extraction_preview: null,
    lease_expires_at: expiredAt,
    lease_token: "00000000-0000-4000-8000-000000000001",
    worker_id: "worker-a",
    created_at: expiredAt,
    updated_at: expiredAt,
  };
  const seen: string[] = [];
  const repository = createSupabaseUploadedDocumentsRepository({
    url: "https://db.test",
    serviceRoleKey: "key",
    now: () => new Date("2026-07-25T12:00:01.000Z"),
    fetchImpl: async (url, init) => {
      seen.push(String(url));
      assert.equal(init?.method, "POST");
      return Response.json([record]);
    },
  });
  assert.equal((await repository.claimNext("worker-a"))?.id, "upload_1");
  assert.match(seen[0]!, /rpc\/claim_next_uploaded_document/);

  const before = createSupabaseUploadedDocumentsRepository({
    url: "https://db.test",
    serviceRoleKey: "key",
    now: () => new Date("2026-07-25T11:59:59.000Z"),
    fetchImpl: async () => Response.json([]),
  });
  assert.equal(await before.claimNext("worker-b"), null);
});

test("Supabase upload creation relies on the database queued default", async () => {
  const requestBodies: Array<Record<string, unknown>> = [];
  const now = "2026-07-25T12:00:00.000Z";
  const repository = createSupabaseUploadedDocumentsRepository({
    url: "https://db.test",
    serviceRoleKey: "key",
    fetchImpl: async (_url, init) => {
      const requestBody = JSON.parse(
        String(init?.body),
      ) as Record<string, unknown>;
      requestBodies.push(requestBody);
      return Response.json([{
        ...requestBody,
        status: "queued",
        failure_reason: null,
        extraction_preview: null,
        deal_id: null,
        source_id: null,
        source_revision_id: null,
        confirmation_fingerprint: null,
        created_at: now,
        updated_at: now,
      }]);
    },
  });

  await repository.create({
    id: "upload_staging",
    workspaceId: "workspace_demo",
    filename: "staging.txt",
    contentType: "text/plain",
    byteSize: 12,
    checksum: "staging-hash",
    objectKey: "private/workspaces/workspace_demo/staging.txt",
  });

  const requestBody = requestBodies[0];
  assert.ok(requestBody);
  assert.equal(requestBody.status, undefined);
  assert.deepEqual(Object.keys(requestBody).sort(), [
    "byte_size",
    "checksum",
    "content_type",
    "filename",
    "id",
    "object_key",
    "workspace_id",
  ]);
});

test("Supabase terminal lease mutations use the database-time transition RPC", async () => {
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  const repository = createSupabaseUploadedDocumentsRepository({
    url: "https://db.test",
    serviceRoleKey: "key",
    fetchImpl: async (url, init) => {
      requests.push({
        url: String(url),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      });
      assert.equal(init?.method, "POST");
      return Response.json(true);
    },
  });
  const lease = {
    workspaceId: "workspace_demo",
    id: "upload_1",
    workerId: "worker-a",
    leaseToken: "00000000-0000-4000-8000-000000000001",
  };

  assert.equal(await repository.savePreview({
    ...lease,
    preview: previewFixture(),
  }), true);
  assert.equal(await repository.fail({
    ...lease,
    reason: "extraction failed",
  }), true);
  assert.equal(await repository.completeConfirmed(lease), true);
  assert.equal(await repository.failConfirmed({
    ...lease,
    reason: "ingest failed",
  }), true);
  assert.deepEqual(
    requests.map(({ url, body }) => ({
      pathname: new URL(url).pathname,
      transition: body.p_transition,
      hasPreview: body.p_extraction_preview !== null,
      failureReason: body.p_failure_reason,
    })),
    [
      {
        pathname: "/rest/v1/rpc/transition_uploaded_document_lease",
        transition: "extraction_complete",
        hasPreview: true,
        failureReason: null,
      },
      {
        pathname: "/rest/v1/rpc/transition_uploaded_document_lease",
        transition: "extraction_fail",
        hasPreview: false,
        failureReason: "extraction failed",
      },
      {
        pathname: "/rest/v1/rpc/transition_uploaded_document_lease",
        transition: "confirmed_complete",
        hasPreview: false,
        failureReason: null,
      },
      {
        pathname: "/rest/v1/rpc/transition_uploaded_document_lease",
        transition: "confirmed_fail",
        hasPreview: false,
        failureReason: "ingest failed",
      },
    ],
  );
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

async function uploadFixture(filename: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(
    new URL(`../fixtures/uploads/${filename}`, import.meta.url),
  ));
}

function mutateDocx(
  source: Uint8Array,
  mutate: (archive: {
    bytes: Uint8Array;
    view: DataView;
    eocd: number;
    centralEntries: Map<string, number>;
  }) => void,
): Uint8Array {
  const bytes = source.slice();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findSignatureFromEnd(view, 0x06054b50);
  assert.ok(eocd >= 0);
  const entryCount = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const centralEntries = new Map<string, number>();
  for (let index = 0; index < entryCount; index += 1) {
    assert.equal(view.getUint32(offset, true), 0x02014b50);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const nameStart = offset + 46;
    const name = new TextDecoder().decode(
      bytes.subarray(nameStart, nameStart + nameLength),
    );
    centralEntries.set(name, offset);
    offset = nameStart + nameLength + extraLength + commentLength;
  }
  mutate({ bytes, view, eocd, centralEntries });
  return bytes;
}

function replaceCentralEntryName(
  bytes: Uint8Array,
  centralOffset: number,
  replacement: string,
): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const nameLength = view.getUint16(centralOffset + 28, true);
  const encoded = new TextEncoder().encode(replacement);
  assert.equal(encoded.byteLength, nameLength);
  bytes.set(encoded, centralOffset + 46);
}

function findSignatureFromEnd(view: DataView, signature: number): number {
  for (let offset = view.byteLength - 4; offset >= 0; offset -= 1) {
    if (view.getUint32(offset, true) === signature) return offset;
  }
  return -1;
}
