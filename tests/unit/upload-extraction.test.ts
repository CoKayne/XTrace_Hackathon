import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryUploadedDocumentsRepository } from "../../db/repositories/uploaded-documents";
import { DealMemoryBundleSchema } from "../../lib/contracts/domain";
import {
  resolveUploadContentType,
  safeFilename,
  UnsupportedUploadError,
  uploadedDealId,
  uploadedObjectKey,
} from "../../lib/uploads/service";
import {
  buildUploadedDealBundle,
  extractDealProfile,
  extractDocumentText,
} from "../../worker/extract-upload";

const RECORD = {
  id: "upload_abc",
  workspaceId: "workspace_demo",
  filename: "acme-deck.pdf",
  contentType: "application/pdf",
  byteSize: 1_024,
  checksum: "abc123",
  objectKey: "private/uploads/abc123/acme-deck.pdf",
  status: "extracting" as const,
  failureReason: null,
  companyName: null,
  headline: null,
  extractedFacts: [],
  memoryTexts: [],
  memoryIds: [],
  xtraceJobId: null,
  dealId: null,
  createdAt: "2026-07-25T12:00:00.000Z",
  updatedAt: "2026-07-25T12:00:00.000Z",
};

test("upload content types come from the filename, not the browser's guess", () => {
  assert.equal(
    resolveUploadContentType({ filename: "deck.pdf", reportedType: "application/octet-stream" }),
    "application/pdf",
  );
  assert.equal(
    resolveUploadContentType({ filename: "memo.DOCX" }),
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );
  assert.throws(
    () => resolveUploadContentType({ filename: "malware.exe" }),
    UnsupportedUploadError,
  );
});

test("upload filenames and object keys cannot escape their prefix", () => {
  assert.equal(safeFilename("../../etc/passwd"), "passwd");
  assert.equal(safeFilename("a b/c:d.pdf"), "c_d.pdf");
  assert.match(
    uploadedObjectKey({ checksum: "abc", filename: "../evil.pdf" }),
    /^private\/uploads\/abc\/evil\.pdf$/,
  );
});

test("plain-text extraction rejects documents with no readable text", async () => {
  const text = await extractDocumentText({
    bytes: new TextEncoder().encode(
      "Acme builds realtime logistics software for mid-market carriers.",
    ),
    contentType: "text/plain",
    filename: "acme.txt",
  });
  assert.match(text, /realtime logistics/);

  await assert.rejects(
    extractDocumentText({
      bytes: new TextEncoder().encode("  \n "),
      contentType: "text/plain",
      filename: "blank.txt",
    }),
    /No readable text/,
  );
});

test("extraction keeps only facts whose excerpt is verbatim in the document", async () => {
  const documentText = "Acme serves 240 carriers. Revenue grew to $4.2M in 2025.";
  const profile = await extractDealProfile({
    client: {
      async complete() {
        return JSON.stringify({
          companyName: "Acme",
          headline: "Acme serves 240 carriers.",
          facts: [
            { text: "Customer base", excerpt: "Acme serves 240 carriers." },
            { text: "Revenue", excerpt: "Revenue grew to $4.2M in 2025." },
            { text: "Fabricated", excerpt: "Acme raised a $30M Series B." },
          ],
        });
      },
    },
    documentText,
    filename: "acme.txt",
  });

  assert.equal(profile.companyName, "Acme");
  assert.deepEqual(profile.facts.map((fact) => fact.text), ["Customer base", "Revenue"]);
});

test("an uploaded bundle carries source lineage and no synthetic decision record", () => {
  const bundle = buildUploadedDealBundle({
    record: RECORD,
    dealId: uploadedDealId(RECORD.checksum),
    companyName: "Acme",
    headline: "Acme serves 240 carriers.",
    facts: [{ text: "Customer base", excerpt: "Acme serves 240 carriers." }],
  });

  const parsed = DealMemoryBundleSchema.parse(bundle);
  assert.equal(parsed.status, "screening");
  assert.deepEqual(parsed.interactions, []);
  assert.ok(parsed.facts.every((fact) =>
    fact.sources.every((source) =>
      source.provenance === "source_document" && source.documentId === RECORD.id
    )
  ));
  assert.ok(
    !parsed.dealId.startsWith("deal_1906"),
    "uploaded deals must not collide with preloaded deal ids",
  );
});

test("claiming an upload is exclusive until its lease expires", async () => {
  let clock = Date.parse("2026-07-25T12:00:00.000Z");
  const repository = createMemoryUploadedDocumentsRepository({
    now: () => new Date(clock),
  });
  await repository.create({
    id: "upload_1",
    workspaceId: "workspace_demo",
    filename: "a.pdf",
    contentType: "application/pdf",
    byteSize: 10,
    checksum: "sum1",
    objectKey: "private/uploads/sum1/a.pdf",
  });

  assert.equal((await repository.claimNext("worker-a"))?.id, "upload_1");
  assert.equal(await repository.claimNext("worker-b"), null);

  clock += 6 * 60_000;
  assert.equal(
    (await repository.claimNext("worker-b"))?.id,
    "upload_1",
    "an expired lease must be reclaimable after a worker crash",
  );

  await repository.complete({
    id: "upload_1",
    companyName: "Acme",
    headline: "Acme serves carriers.",
    extractedFacts: [],
    memoryTexts: ["remembered"],
    memoryIds: ["mem_1"],
    xtraceJobId: "job_1",
    dealId: "deal_upload_sum1",
  });
  const [record] = await repository.list("workspace_demo");
  assert.equal(record.status, "ready");
  assert.deepEqual(record.memoryIds, ["mem_1"]);
  assert.equal(await repository.claimNext("worker-c"), null);
});

test("an image-only PDF falls back to reading the rendered pages", async () => {
  // A one-page PDF whose only content stream draws nothing: no text layer.
  const emptyPdf = new TextEncoder().encode(
    "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
    + "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
    + "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n"
    + "trailer<</Root 1 0 R>>",
  );
  const prompts: string[] = [];
  const text = await extractDocumentText({
    bytes: emptyPdf,
    contentType: "application/pdf",
    filename: "deck.pdf",
    client: {
      async complete(input) {
        prompts.push(JSON.stringify(input.messages));
        return "Acme Logistics. Series A deck. We serve 240 carriers across the Midwest.";
      },
    },
  });

  assert.match(text, /240 carriers/);
  assert.match(prompts[0], /"type":"document"/, "the PDF itself must be sent to the model");
  assert.match(prompts[0], /"media_type":"application\/pdf"/);
});

test("a document with neither text nor a vision fallback fails honestly", async () => {
  await assert.rejects(
    extractDocumentText({
      bytes: new TextEncoder().encode(" "),
      contentType: "text/plain",
      filename: "blank.txt",
    }),
    /No readable text/,
  );
});
