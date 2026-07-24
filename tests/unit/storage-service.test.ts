import assert from "node:assert/strict";
import test from "node:test";

import { GET as readDocumentRoute } from "../../app/api/documents/[id]/route";
import {
  createDefaultPrivateDocumentAccess,
  createMemoryDemoDataStore,
  createMemoryPrivateObjectStorage,
  createPrivateDocumentAccess,
  createSupabaseDemoDataStore,
} from "../../lib/storage/service";
import { listPreloadedDocuments } from "../../lib/corpus/manifest";

test("private document access issues only same-origin backend reads valid for at most ten minutes", async () => {
  let now = 1_700_000_000_000;
  const access = createPrivateDocumentAccess({
    signingSecret: "unit-test-signing-secret-at-least-32-bytes",
    now: () => now,
  });

  const url = await access.createPrivateReadUrl({
    documentId: "doc_7bridges",
    expiresInSeconds: 600,
  });
  const parsed = new URL(url, "https://app.example.test");
  assert.equal(parsed.origin, "https://app.example.test");
  assert.equal(parsed.pathname, "/api/documents/doc_7bridges");
  assert.equal(parsed.searchParams.get("expires"), "1700000600");
  assert.match(parsed.searchParams.get("signature") ?? "", /^[A-Za-z0-9_-]+$/);
  assert.equal(parsed.searchParams.has("token"), false);
  assert.equal(parsed.searchParams.has("write"), false);
  assert.equal(await access.authorizePrivateRead(new Request(parsed)), "doc_7bridges");

  now += 601_000;
  await assert.rejects(
    access.authorizePrivateRead(new Request(parsed)),
    /expired/i,
  );
  await assert.rejects(
    access.createPrivateReadUrl({ documentId: "doc_7bridges", expiresInSeconds: 601 }),
    /600 seconds/i,
  );
});

test("memory storage upserts stable records and private objects without duplicates", async () => {
  const data = createMemoryDemoDataStore();
  const objects = createMemoryPrivateObjectStorage();
  const workspace = { id: "workspace_demo", name: "XTrace Demo" };

  assert.equal((await data.ensureWorkspace(workspace)).created, true);
  assert.equal((await data.ensureWorkspace(workspace)).created, false);
  assert.equal((await objects.ensurePrivateObject({
    key: "private/demo/file.pdf",
    bytes: new Uint8Array([1, 2, 3]),
    contentType: "application/pdf",
  })).created, true);
  assert.equal((await objects.ensurePrivateObject({
    key: "private/demo/file.pdf",
    bytes: new Uint8Array([1, 2, 3]),
    contentType: "application/pdf",
  })).created, false);

  assert.equal(data.inspect().workspaces.length, 1);
  assert.equal(objects.inspect().length, 1);
});

test("PostgreSQL storage reads durable workspace-document confirmations", async () => {
  let requestedUrl = "";
  const data = createSupabaseDemoDataStore({
    url: "https://database.example.test",
    serviceRoleKey: "test-service-role",
    async fetchImpl(input) {
      requestedUrl = String(input);
      return Response.json([
        { document_id: "doc_market_ai" },
        { document_id: "doc_7bridges" },
      ]);
    },
  });

  assert.deepEqual(
    await data.listWorkspaceDocumentIds("workspace_demo"),
    ["doc_7bridges", "doc_market_ai"],
  );
  const parsed = new URL(requestedUrl);
  assert.equal(parsed.pathname, "/rest/v1/workspace_documents");
  assert.equal(parsed.searchParams.get("workspace_id"), "eq.workspace_demo");
  assert.equal(parsed.searchParams.get("select"), "document_id");
});

test("the backend document route requires a valid read capability and never exposes storage credentials", async () => {
  const document = listPreloadedDocuments()[0];
  const unsigned = await readDocumentRoute(
    new Request(`https://app.example.test/api/documents/${document.id}`),
    { params: Promise.resolve({ id: document.id }) },
  );
  assert.equal(unsigned.status, 404);

  const access = createDefaultPrivateDocumentAccess();
  const signedPath = await access.createPrivateReadUrl({
    documentId: document.id,
    expiresInSeconds: 600,
  });
  const response = await readDocumentRoute(
    new Request(new URL(signedPath, "https://app.example.test")),
    { params: Promise.resolve({ id: document.id }) },
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/pdf");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.has("authorization"), false);
  assert.equal(response.headers.has("x-write-token"), false);
  assert.equal((await response.arrayBuffer()).byteLength, document.byteSize);
});
