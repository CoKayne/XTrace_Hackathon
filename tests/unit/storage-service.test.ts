import assert from "node:assert/strict";
import test from "node:test";

import "../helpers/public-demo";
import { GET as readDocumentRoute } from "../../app/api/documents/[id]/route";
import {
  createMemoryDemoDataStore,
  createMemoryPrivateObjectStorage,
  createPrivateDocumentAccess,
  createSupabaseDemoDataStore,
  createSupabasePrivateObjectStorage,
} from "../../lib/storage/service";
import { listPreloadedDocuments } from "../../lib/corpus/manifest";
import { DEMO_FIXTURE_LABEL } from "../../lib/contracts/domain";

test("private document access signs and validates the exact workspace-scoped source capability", async () => {
  let now = 1_700_000_000_000;
  const access = createPrivateDocumentAccess({
    signingSecret: "unit-test-signing-secret-at-least-32-bytes",
    now: () => now,
  });

  const url = await access.createPrivateReadUrl({
    capability: {
      workspaceId: "workspace_one",
      sourceRevisionId: "doc_7bridges",
      objectVersion: "sha256-version-one",
      expiresAtEpochSeconds: 1_700_000_600,
      permission: "read",
    },
    expiresInSeconds: 600,
  });
  const parsed = new URL(url, "https://app.example.test");
  assert.equal(parsed.origin, "https://app.example.test");
  assert.equal(parsed.pathname, "/api/documents/doc_7bridges");
  assert.match(parsed.searchParams.get("capability") ?? "", /^[A-Za-z0-9_-]+$/);
  assert.match(parsed.searchParams.get("signature") ?? "", /^[A-Za-z0-9_-]+$/);
  assert.equal(parsed.searchParams.has("token"), false);
  assert.equal(parsed.searchParams.has("write"), false);
  assert.deepEqual(await access.authorizePrivateRead(new Request(parsed)), {
    workspaceId: "workspace_one",
    sourceRevisionId: "doc_7bridges",
    objectVersion: "sha256-version-one",
    expiresAtEpochSeconds: 1_700_000_600,
    permission: "read",
  });

  const forged = new URL(parsed);
  const encodedCapability = forged.searchParams.get("capability");
  assert.ok(encodedCapability);
  const decoded = JSON.parse(
    Buffer.from(encodedCapability, "base64url").toString("utf8"),
  ) as Record<string, unknown>;
  forged.searchParams.set(
    "capability",
    Buffer.from(JSON.stringify({
      ...decoded,
      workspaceId: "workspace_attacker",
    })).toString("base64url"),
  );
  await assert.rejects(
    access.authorizePrivateRead(new Request(forged)),
    /invalid/i,
  );

  now += 601_000;
  await assert.rejects(
    access.authorizePrivateRead(new Request(parsed)),
    /expired/i,
  );
  await assert.rejects(
    access.createPrivateReadUrl({
      capability: {
        workspaceId: "workspace_one",
        sourceRevisionId: "doc_7bridges",
        objectVersion: "sha256-version-one",
        expiresAtEpochSeconds: 1_700_001_202,
        permission: "read",
      },
      expiresInSeconds: 601,
    }),
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

test("Supabase storage uploads when a missing object is reported as HTTP 400 with nested 404", async () => {
  const methods: string[] = [];
  const objects = createSupabasePrivateObjectStorage({
    url: "https://database.example.test",
    serviceRoleKey: "test-service-role",
    async fetchImpl(_input, init) {
      methods.push(init?.method ?? "GET");
      if (init?.method === "POST") {
        return new Response(null, { status: 200 });
      }
      return Response.json(
        { statusCode: "404", error: "not_found", message: "Object not found" },
        { status: 400 },
      );
    },
  });

  const result = await objects.ensurePrivateObject({
    key: "private/demo/file.pdf",
    bytes: new Uint8Array([1, 2, 3]),
    contentType: "application/pdf",
  });

  assert.equal(result.created, true);
  assert.deepEqual(methods, ["GET", "POST"]);
});

test("Supabase storage reads a nested HTTP 400/404 response as a missing object", async () => {
  const objects = createSupabasePrivateObjectStorage({
    url: "https://database.example.test",
    serviceRoleKey: "test-service-role",
    async fetchImpl() {
      return Response.json(
        { statusCode: "404", error: "not_found", message: "Object not found" },
        { status: 400 },
      );
    },
  });

  assert.equal(await objects.readPrivateObject("private/demo/missing.pdf"), null);
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

test("PostgreSQL storage durably writes the synthetic decision rationale", async () => {
  let interactionPost: { url: string; body: Record<string, unknown> } | undefined;
  const data = createSupabaseDemoDataStore({
    url: "https://database.example.test",
    serviceRoleKey: "test-service-role",
    async fetchImpl(input, init) {
      if (init?.method === "POST") {
        interactionPost = {
          url: String(input),
          body: JSON.parse(String(init.body)) as Record<string, unknown>,
        };
        return new Response(null, { status: 204 });
      }
      return Response.json([]);
    },
  });

  await data.ensureFixture({
    id: "fixture_1",
    workspaceId: "workspace_demo",
    documentId: "doc_1",
    dealId: "deal_1",
    companyName: "Asteria Bio",
    occurredAt: "2026-07-01T00:00:00.000Z",
    provenance: "demo_fixture",
    label: DEMO_FIXTURE_LABEL,
    status: "passed",
    decisionReason: "Synthetic decision: pass until regulatory timing changes.",
    concerns: ["Regulatory timing"],
    revisitConditions: ["Regulatory timing changes"],
    meetingSummary: "Synthetic internal decision record.",
  });

  assert.equal(
    new URL(interactionPost?.url ?? "https://invalid.test").pathname,
    "/rest/v1/deal_interactions",
  );
  assert.equal(
    interactionPost?.body.decision_reason,
    "Synthetic decision: pass until regulatory timing changes.",
  );
});

test("the public demo document route serves only the fixed preloaded PDF without storage credentials", async () => {
  const document = listPreloadedDocuments()[0];
  const response = await readDocumentRoute(
    new Request(`https://app.example.test/api/documents/${document.id}`),
    { params: Promise.resolve({ id: document.id }) },
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/pdf");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.has("authorization"), false);
  assert.equal(response.headers.has("x-write-token"), false);
  assert.equal((await response.arrayBuffer()).byteLength, document.byteSize);
});
