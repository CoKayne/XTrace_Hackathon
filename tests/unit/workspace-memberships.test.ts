import assert from "node:assert/strict";
import test from "node:test";

import {
  createSupabaseWorkspaceMembershipsRepository,
  getWorkspaceMembershipsRepository,
} from "../../db/repositories/workspace-memberships";
import { IntegrationTransportError } from "../../lib/api/errors";

test("membership resolution queries a server-side membership by user and returns its authorized role", async () => {
  let requestedUrl = "";
  const repository = createSupabaseWorkspaceMembershipsRepository({
    url: "https://project.supabase.co",
    serviceRoleKey: "server-only",
    fetchImpl: async (input) => {
      requestedUrl = String(input);
      return Response.json([{ workspace_id: "workspace_real", role: "partner" }]);
    },
  });

  assert.deepEqual(await repository.resolvePrimaryMembership("user_1"), {
    workspaceId: "workspace_real",
    role: "partner",
  });

  const request = new URL(requestedUrl);
  assert.equal(request.pathname, "/rest/v1/workspace_members");
  assert.equal(request.searchParams.get("user_id"), "eq.user_1");
  assert.equal(request.searchParams.get("select"), "workspace_id,role");
  assert.equal(request.searchParams.get("limit"), "2");
  assert.equal(request.searchParams.get("workspace_id"), null);
  assert.equal(request.searchParams.get("order"), null);
});

test("membership resolution fails closed when the stored role is not authorized", async () => {
  const repository = createSupabaseWorkspaceMembershipsRepository({
    url: "https://project.supabase.co",
    serviceRoleKey: "server-only",
    fetchImpl: async () => Response.json([{ workspace_id: "workspace_real", role: "demo" }]),
  });

  assert.equal(await repository.resolvePrimaryMembership("user_1"), null);
});

test("membership resolution fails closed for zero, corrupt, and multiple rows regardless of order", async () => {
  for (const rows of [
    [],
    [{ workspace_id: "", role: "owner" }],
    [{ workspace_id: "workspace_a", role: "owner" }, { workspace_id: "workspace_b", role: "partner" }],
    [{ workspace_id: "workspace_b", role: "partner" }, { workspace_id: "workspace_a", role: "owner" }],
  ]) {
    const repository = createSupabaseWorkspaceMembershipsRepository({
      url: "https://project.supabase.co",
      serviceRoleKey: "server-only",
      fetchImpl: async () => Response.json(rows),
    });
    assert.equal(await repository.resolvePrimaryMembership("user_1"), null);
  }
});

test("membership resolution rejects malformed provider payloads without selecting a workspace", async () => {
  for (const response of [
    new Response("not json", { headers: { "content-type": "application/json" } }),
    Response.json({ workspace_id: "workspace_real", role: "owner" }),
  ]) {
    const repository = createSupabaseWorkspaceMembershipsRepository({
      url: "https://project.supabase.co",
      serviceRoleKey: "server-only",
      fetchImpl: async () => response.clone(),
    });
    await assert.rejects(repository.resolvePrimaryMembership("user_1"), /INTERNAL_ERROR/);
  }
});

test("membership transport failures retain retryability without exposing gateway details", async () => {
  for (const input of [
    async () => { throw new TypeError("connect ECONNREFUSED secret-host"); },
    async () => new Response("upstream secret", { status: 429 }),
    async () => new Response("upstream secret", { status: 503 }),
  ]) {
    const repository = createSupabaseWorkspaceMembershipsRepository({
      url: "https://project.supabase.co",
      serviceRoleKey: "server-only",
      fetchImpl: input,
    });
    await assert.rejects(repository.resolvePrimaryMembership("user_1"), (error: unknown) =>
      error instanceof IntegrationTransportError && error.retryable,
    );
  }

  const repository = createSupabaseWorkspaceMembershipsRepository({
    url: "https://project.supabase.co",
    serviceRoleKey: "server-only",
    fetchImpl: async () => new Response("not authorized", { status: 401 }),
  });
  await assert.rejects(repository.resolvePrimaryMembership("user_1"), (error: unknown) =>
    error instanceof IntegrationTransportError && !error.retryable,
  );
});

test("membership repository rejects missing, blank, and malformed deployment configuration", () => {
  for (const environment of [
    {},
    { SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "server-only" },
    { SUPABASE_URL: "   ", SUPABASE_SERVICE_ROLE_KEY: "server-only" },
    { SUPABASE_URL: "https://project.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "   " },
    { SUPABASE_URL: "postgres://database.internal", SUPABASE_SERVICE_ROLE_KEY: "server-only" },
    { SUPABASE_URL: "not a url", SUPABASE_SERVICE_ROLE_KEY: "server-only" },
  ]) {
    assert.throws(() => getWorkspaceMembershipsRepository(environment), /INTERNAL_ERROR/);
  }
});
