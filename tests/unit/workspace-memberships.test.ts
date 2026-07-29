import assert from "node:assert/strict";
import test from "node:test";

import { createSupabaseWorkspaceMembershipsRepository } from "../../db/repositories/workspace-memberships";

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
  assert.equal(request.searchParams.get("limit"), "1");
  assert.equal(request.searchParams.get("workspace_id"), null);
});

test("membership resolution fails closed when the stored role is not authorized", async () => {
  const repository = createSupabaseWorkspaceMembershipsRepository({
    url: "https://project.supabase.co",
    serviceRoleKey: "server-only",
    fetchImpl: async () => Response.json([{ workspace_id: "workspace_real", role: "demo" }]),
  });

  assert.equal(await repository.resolvePrimaryMembership("user_1"), null);
});
