import assert from "node:assert/strict";
import test from "node:test";

import {
  ActiveScanResetError,
  afterReset,
  createMemoryTestGenerationRepository,
  createSupabaseTestGenerationRepository,
  filterAfterReset,
} from "../../db/repositories/test-generations";

test("reset filtering uses a strict timestamp boundary", () => {
  const resetAt = "2026-07-30T12:00:00.000Z";
  assert.equal(afterReset("2026-07-30T11:59:59.999Z", resetAt), false);
  assert.equal(afterReset(resetAt, resetAt), false);
  assert.equal(afterReset("2026-07-30T12:00:00.001Z", resetAt), true);
  assert.equal(afterReset("2020-01-01T00:00:00.000Z", null), true);

  assert.deepEqual(
    filterAfterReset([
      { id: "old", createdAt: "2026-07-30T11:59:59.999Z" },
      { id: "boundary", createdAt: resetAt },
      { id: "new", createdAt: "2026-07-30T12:00:00.001Z" },
    ], resetAt).map(({ id }) => id),
    ["new"],
  );
});

test("memory generations advance one workspace without affecting another", async () => {
  const repository = createMemoryTestGenerationRepository({
    now: () => new Date("2026-07-30T12:00:00.123Z"),
  });

  assert.equal(await repository.currentResetAt("workspace_one"), null);
  assert.deepEqual(
    await repository.advance({
      workspaceId: "workspace_one",
      actorId: "system:public-sandbox",
    }),
    { resetAt: "2026-07-30T12:00:00.123Z" },
  );
  assert.equal(
    await repository.currentResetAt("workspace_one"),
    "2026-07-30T12:00:00.123Z",
  );
  assert.equal(await repository.currentResetAt("workspace_two"), null);
});

test("memory generations refuse to advance while a scan is active", async () => {
  const repository = createMemoryTestGenerationRepository({
    now: () => new Date("2026-07-30T12:00:00.000Z"),
    hasActiveScan: async (workspaceId) => workspaceId === "workspace_active",
  });

  await assert.rejects(
    repository.advance({
      workspaceId: "workspace_active",
      actorId: "system:public-sandbox",
    }),
    ActiveScanResetError,
  );
  assert.equal(await repository.currentResetAt("workspace_active"), null);
});

test("Supabase generations scope reads and controlled advances by workspace", async () => {
  const calls: Array<{ url: URL; method: string; body: unknown }> = [];
  const repository = createSupabaseTestGenerationRepository({
    url: "https://example.supabase.co",
    serviceRoleKey: "test-service-role-key",
    async fetchImpl(input, init) {
      const url = new URL(String(input));
      calls.push({
        url,
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      if (url.pathname.endsWith("/rpc/reset_test_view")) {
        return Response.json({
          reset: true,
          resetAt: "2026-07-30T12:00:00.000Z",
        });
      }
      return Response.json([{ reset_at: "2026-07-29T12:00:00.000Z" }]);
    },
  });

  assert.equal(
    await repository.currentResetAt("workspace_one"),
    "2026-07-29T12:00:00.000Z",
  );
  assert.deepEqual(
    await repository.advance({
      workspaceId: "workspace_one",
      actorId: "system:public-sandbox",
    }),
    { resetAt: "2026-07-30T12:00:00.000Z" },
  );

  assert.equal(
    calls[0]?.url.searchParams.get("workspace_id"),
    "eq.workspace_one",
  );
  assert.equal(calls[0]?.url.searchParams.get("select"), "reset_at");
  assert.deepEqual(calls[1], {
    url: new URL(
      "https://example.supabase.co/rest/v1/rpc/reset_test_view",
    ),
    method: "POST",
    body: {
      p_workspace_id: "workspace_one",
      p_actor_id: "system:public-sandbox",
    },
  });
});

test("Supabase generations map only the active-scan operation result to the typed error", async () => {
  const repository = createSupabaseTestGenerationRepository({
    url: "https://example.supabase.co",
    serviceRoleKey: "test-service-role-key",
    fetchImpl: async () =>
      Response.json({ reset: false, reason: "active_scan" }),
  });

  await assert.rejects(
    repository.advance({
      workspaceId: "workspace_active",
      actorId: "system:public-sandbox",
    }),
    ActiveScanResetError,
  );
});
