import assert from "node:assert/strict";
import test from "node:test";

import { resolveRequestContext } from "../../lib/auth/request-context";
import { errorResponse } from "../../lib/api/response";

function productContextFixture(input: {
  membership: { workspaceId: string; role: "owner" | "partner" | "associate" | "admin" } | null;
  principal?: { userId: string; email: string } | null;
}): Parameters<typeof resolveRequestContext>[1] {
  return {
    environment: { VSEE_DEPLOYMENT_MODE: "product" },
    resolveSession: async () => input.principal === undefined
      ? { userId: "user_1", email: "user@example.com" }
      : input.principal,
    memberships: {
      resolvePrimaryMembership: async () => input.membership,
    },
  };
}

test("public demo resolves the server demo workspace with mutation disabled", async () => {
  const context = await resolveRequestContext(new Request("https://vsee.test/api/deals"), {
    environment: {
      VSEE_DEPLOYMENT_MODE: "public_demo",
      DEMO_WORKSPACE_ID: "workspace_demo",
    },
  });

  assert.equal(context.workspaceId, "workspace_demo");
  assert.equal(context.role, "demo");
  assert.deepEqual(context.permissions, {
    readWorkspace: true,
    readPrivateSources: false,
    mutateSources: false,
    managePolicy: false,
    administerFrameworks: false,
  });
});

test("product mode ignores a forged workspace and resolves membership", async () => {
  const request = new Request("https://vsee.test/api/deals?workspaceId=attacker", {
    headers: { "x-workspace-id": "attacker", cookie: "workspaceId=attacker" },
  });
  const context = await resolveRequestContext(request, productContextFixture({
    membership: { workspaceId: "workspace_real", role: "partner" },
  }));

  assert.equal(context.workspaceId, "workspace_real");
  assert.equal(context.role, "partner");
  assert.equal(context.permissions.readPrivateSources, true);
  assert.equal(context.permissions.mutateSources, true);
});

test("product mode rejects an authenticated non-member", async () => {
  await assert.rejects(
    resolveRequestContext(new Request("https://vsee.test/api/deals"), productContextFixture({
      membership: null,
    })),
    /FORBIDDEN/,
  );
});

test("product mode rejects a request without a trusted authenticated principal", async () => {
  await assert.rejects(
    resolveRequestContext(new Request("https://vsee.test/api/deals"), productContextFixture({
      membership: { workspaceId: "workspace_real", role: "owner" },
      principal: null,
    })),
    /UNAUTHENTICATED/,
  );
});

test("missing or invalid deployment configuration never selects public demo", async () => {
  await assert.rejects(
    resolveRequestContext(new Request("https://vsee.test/api/deals"), {
      environment: { DEMO_WORKSPACE_ID: "workspace_demo" },
    }),
    /INTERNAL_ERROR/,
  );
  await assert.rejects(
    resolveRequestContext(new Request("https://vsee.test/api/deals"), {
      environment: { VSEE_DEPLOYMENT_MODE: "preview", DEMO_WORKSPACE_ID: "workspace_demo" },
    }),
    /INTERNAL_ERROR/,
  );
});

test("API errors expose fixed public messages and never leak unexpected details", async () => {
  const unauthenticated = errorResponse(new Error("UNAUTHENTICATED"));
  assert.equal(unauthenticated.status, 401);
  assert.deepEqual(await unauthenticated.json(), {
    error: { code: "UNAUTHENTICATED", message: "Authentication required", retryable: false },
  });

  const unavailable = errorResponse(new TypeError("fetch failed"));
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), {
    error: { code: "INTEGRATION_UNAVAILABLE", message: "A required service is unavailable", retryable: true },
  });

  const unexpected = errorResponse(new Error("postgres://admin:secret@internal.example"));
  assert.equal(unexpected.status, 500);
  assert.deepEqual(await unexpected.json(), {
    error: { code: "INTERNAL_ERROR", message: "Internal server error", retryable: false },
  });
});
