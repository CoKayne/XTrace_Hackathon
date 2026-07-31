import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { errorResponse } from "../../lib/api/response";
import { createClaudeClient } from "../../lib/claude/client";
import {
  createSupabaseDemoDataStore,
  createSupabasePrivateObjectStorage,
} from "../../lib/storage/service";

async function publicError(operation: () => Promise<unknown>) {
  try {
    await operation();
    assert.fail("expected the external operation to fail");
  } catch (error) {
    const response = errorResponse(error);
    return {
      status: response.status,
      body: await response.json() as {
        error: { code: string; message: string; retryable: boolean };
      },
    };
  }
}

function assertRetryableUnavailable(
  result: { status: number; body: { error: { code: string; message: string; retryable: boolean } } },
) {
  assert.equal(result.status, 503);
  assert.deepEqual(result.body, {
    error: {
      code: "INTEGRATION_UNAVAILABLE",
      message: "A required service is unavailable",
      retryable: true,
    },
  });
  assert.doesNotMatch(JSON.stringify(result.body), /provider-secret|database-secret|object-secret/i);
}

function assertNonRetryableInternal(
  result: { status: number; body: { error: { code: string; message: string; retryable: boolean } } },
) {
  assert.equal(result.status, 500);
  assert.deepEqual(result.body, {
    error: {
      code: "INTERNAL_ERROR",
      message: "Internal server error",
      retryable: false,
    },
  });
  assert.doesNotMatch(JSON.stringify(result.body), /provider-secret|database-secret|object-secret/i);
}

for (const [label, fetchImpl] of [
  ["network rejection", async () => { throw new TypeError("database-secret connection reset"); }],
  ["HTTP 429", async () => new Response("database-secret", { status: 429 })],
  ["HTTP 503", async () => new Response("database-secret", { status: 503 })],
] as const) {
  test(`Supabase demo-data ${label} remains a sanitized retryable error`, async () => {
    const store = createSupabaseDemoDataStore({
      url: "https://database.example.test",
      serviceRoleKey: "server-only",
      fetchImpl,
    });
    assertRetryableUnavailable(await publicError(() => store.listWorkspaceDocumentIds("workspace_demo")));
  });
}

test("Supabase demo-data non-retryable 4xx remains internal", async () => {
  const store = createSupabaseDemoDataStore({
    url: "https://database.example.test",
    serviceRoleKey: "server-only",
    fetchImpl: async () => new Response("database-secret", { status: 401 }),
  });
  assertNonRetryableInternal(await publicError(() => store.listWorkspaceDocumentIds("workspace_demo")));
});

for (const [label, fetchImpl] of [
  ["network rejection", async () => { throw new TypeError("object-secret connection reset"); }],
  ["HTTP 429", async () => new Response("object-secret", { status: 429 })],
  ["HTTP 503", async () => new Response("object-secret", { status: 503 })],
] as const) {
  test(`Supabase private-object ${label} remains a sanitized retryable error`, async () => {
    const objects = createSupabasePrivateObjectStorage({
      url: "https://database.example.test",
      serviceRoleKey: "server-only",
      fetchImpl,
    });
    assertRetryableUnavailable(await publicError(() => objects.readPrivateObject("private/demo/object.txt")));
  });
}

test("Supabase private-object non-retryable 4xx remains internal", async () => {
  const objects = createSupabasePrivateObjectStorage({
    url: "https://database.example.test",
    serviceRoleKey: "server-only",
    fetchImpl: async () => new Response("object-secret", { status: 401 }),
  });
  assertNonRetryableInternal(await publicError(() => objects.readPrivateObject("private/demo/object.txt")));
});

for (const [label, fetchImpl] of [
  ["network rejection", async () => { throw new TypeError("provider-secret connection reset"); }],
  ["HTTP 429", async () => new Response("provider-secret", { status: 429 })],
  ["HTTP 503", async () => new Response("provider-secret", { status: 503 })],
] as const) {
  test(`Anthropic ${label} after retry remains a sanitized retryable error`, async () => {
    const client = createClaudeClient({ apiKey: "test-key", backoffMs: 0, fetchImpl });
    assertRetryableUnavailable(await publicError(() => client.complete({
      system: "Answer briefly.",
      messages: [{ role: "user", content: "Test" }],
    })));
  });
}

test("Anthropic non-retryable 4xx remains internal", async () => {
  const client = createClaudeClient({
    apiKey: "test-key",
    backoffMs: 0,
    fetchImpl: async () => new Response("provider-secret", { status: 401 }),
  });
  assertNonRetryableInternal(await publicError(() => client.complete({
    system: "Answer briefly.",
    messages: [{ role: "user", content: "Test" }],
  })));
});

const verifyFreshWebBundle =
  process.env.VSEE_VERIFY_FRESH_WEB_BUNDLE === "1";

test("document parsers stay in the Node worker and out of a fresh production Web bundle", {
  skip: verifyFreshWebBundle
    ? false
    : "run npm run verify:web-parser-boundary for a fresh production build",
}, async () => {
  const buildStartedAt = Number(
    process.env.VSEE_FRESH_WEB_BUNDLE_STARTED_AT,
  );
  assert.equal(Number.isFinite(buildStartedAt), true);
  const workerSource = await readFile(
    path.join(process.cwd(), "worker", "extract-upload.ts"),
    "utf8",
  );
  assert.match(workerSource, /await import\("unpdf"\)/);
  assert.match(workerSource, /await import\("mammoth"\)/);

  const clientFiles = await collectFiles(path.join(process.cwd(), "dist", "client"));
  assert.ok(
    clientFiles.length > 0,
    "the fresh production build must create client assets",
  );
  for (const file of clientFiles) {
    assert.ok(
      (await stat(file)).mtimeMs >= buildStartedAt,
      `production client asset predates the current verification build: ${file}`,
    );
  }
  const clientBundle = (
    await Promise.all(clientFiles.map((file) => readFile(file, "utf8")))
  ).join("\n");
  assert.doesNotMatch(clientBundle, /\b(?:mammoth|unpdf)\b/);
});

async function collectFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectFiles(target);
    return /\.(?:css|html|js|json)$/.test(entry.name) ? [target] : [];
  }));
  return files.flat();
}
