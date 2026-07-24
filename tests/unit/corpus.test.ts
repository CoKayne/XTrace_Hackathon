import assert from "node:assert/strict";
import test from "node:test";

import { DEMO_FIXTURES } from "../../lib/corpus/fixtures";
import { listPreloadedDocuments } from "../../lib/corpus/manifest";
import {
  confirmImport,
  createCorpusService,
  getSignedDocumentUrl,
  previewImport,
} from "../../lib/corpus/service";

test("the fixed corpus contains 13 product inputs and one reference", () => {
  const documents = listPreloadedDocuments();

  assert.equal(documents.filter((document) => document.role !== "reference").length, 13);
  assert.equal(documents.filter((document) => document.role === "reference").length, 1);
  assert.equal(new Set(documents.map((document) => document.checksum)).size, 14);
});

test("every synthetic interaction is permanently labeled as a demo fixture", () => {
  assert.ok(DEMO_FIXTURES.length >= 3);
  assert.ok(DEMO_FIXTURES.every((fixture) => fixture.provenance === "demo_fixture"));
  assert.ok(DEMO_FIXTURES.every((fixture) => fixture.label.includes("Synthetic VC decision record")));
});

test("preview classifies preloaded documents and requires deal confirmation only for pitch decks", () => {
  const [dealDocument] = listPreloadedDocuments().filter((document) => document.role === "deal_document");
  const [marketReport] = listPreloadedDocuments().filter((document) => document.role === "market_report");

  const preview = previewImport([dealDocument.id, marketReport.id]);

  assert.deepEqual(preview, [
    {
      documentId: dealDocument.id,
      title: dealDocument.title,
      classification: "deal_document",
      company: dealDocument.company,
      requiresDealConfirmation: true,
    },
    {
      documentId: marketReport.id,
      title: marketReport.title,
      classification: "market_report",
      company: undefined,
      requiresDealConfirmation: false,
    },
  ]);
  assert.throws(() => previewImport(["not-in-the-demo-corpus"]), /Unknown preloaded document/);
});

test("confirmation emits a validated memory bundle and delegates persistence through injected interfaces", async () => {
  const [document] = listPreloadedDocuments().filter((item) => item.role === "deal_document");
  const fixture = DEMO_FIXTURES.find((item) => item.documentId === document.id);
  assert.ok(fixture, "a featured fixture should have a source document");

  const stored: string[] = [];
  const service = createCorpusService({
    async ensureWorkspaceDocument({ documentId }) {
      stored.push(`document:${documentId}`);
      return { documentId };
    },
    async ensureDeal({ dealId }) {
      stored.push(`deal:${dealId}`);
      return { dealId };
    },
    async ensureFixture({ fixtureId }) {
      stored.push(`fixture:${fixtureId}`);
      return { fixtureId };
    },
    async createSignedReadUrl({ documentId, expiresInSeconds }) {
      stored.push(`signed:${documentId}:${expiresInSeconds}`);
      return `https://storage.example.test/private/${documentId}?read=only`;
    },
  });

  const result = await confirmImport({
    workspaceId: "workspace_demo",
    documentIds: [document.id],
    dealConfirmations: [{ documentId: document.id, dealId: fixture.dealId }],
  }, service);

  assert.equal(result.memoryBundles.length, 1);
  assert.equal(result.memoryBundles[0].dealId, fixture.dealId);
  assert.equal(result.memoryBundles[0].interactions[0].provenance, "demo_fixture");
  assert.deepEqual(stored.slice(0, 3), [
    `document:${document.id}`,
    `deal:${fixture.dealId}`,
    `fixture:${fixture.id}`,
  ]);
  await assert.rejects(
    confirmImport({ workspaceId: "workspace_demo", documentIds: [document.id], dealConfirmations: [] }, service),
    /requires a confirmed Deal/,
  );

  const signedUrl = await service.getSignedDocumentUrl(document.id);
  assert.match(signedUrl, /^https:\/\/storage\.example\.test\/private\//);
  assert.ok(stored.includes(`signed:${document.id}:600`));

  await getSignedDocumentUrl(document.id, service);
  assert.equal(stored.filter((item) => item === `signed:${document.id}:600`).length, 2);
});
