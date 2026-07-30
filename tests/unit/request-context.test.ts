import assert from "node:assert/strict";
import test from "node:test";

import { resolveRequestContext } from "../../lib/auth/request-context";
import { errorResponse, jsonError } from "../../lib/api/response";
import { IntegrationTransportError } from "../../lib/api/errors";
import { ApiErrorSchema } from "../../lib/contracts/http";
import { uiSessionForContext } from "../../app/ui-capabilities";

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

test("public sandbox resolves one server-owned writable workspace", async () => {
  const context = await resolveRequestContext(
    new Request("https://vsee.test/api/runs", {
      headers: { "x-workspace-id": "attacker_workspace" },
    }),
    {
      environment: {
        VSEE_DEPLOYMENT_MODE: "public_sandbox",
        DEMO_WORKSPACE_ID: "workspace_sandbox",
      },
    },
  );

  assert.equal(context.mode, "public_sandbox");
  assert.equal(context.workspaceId, "workspace_sandbox");
  assert.equal(context.principal?.userId, "system:public-sandbox");
  assert.deepEqual(context.permissions, {
    readWorkspace: true,
    readPrivateSources: true,
    mutateSources: true,
    managePolicy: true,
    administerFrameworks: false,
  });
  assert.deepEqual(uiSessionForContext(context).capabilities, {
    runScans: true,
    resetDemo: true,
    uploadSources: true,
    confirmUploads: true,
    manageFundPolicy: true,
    saveActionDrafts: true,
  });
});

test("product mode ignores a forged workspace and resolves membership", async () => {
  const request = new Request("https://vsee.test/api/deals?workspaceId=attacker", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-workspace-id": "attacker",
      cookie: "workspaceId=attacker",
    },
    body: JSON.stringify({ workspaceId: "attacker" }),
  });
  const context = await resolveRequestContext(request, productContextFixture({
    membership: { workspaceId: "workspace_real", role: "partner" },
  }));

  assert.equal(context.workspaceId, "workspace_real");
  assert.equal(context.role, "partner");
  assert.equal(context.permissions.readPrivateSources, true);
  assert.equal(context.permissions.mutateSources, true);
});

test("product mode uses the enabled OpenAI Sites identity and one server-side membership", async () => {
  let resolvedUserId: string | null = null;
  const context = await resolveRequestContext(
    new Request("https://vsee.test/api/deals?workspaceId=attacker", {
      headers: {
        cookie: "workspaceId=attacker",
        "oai-authenticated-user-email": "Alice@Example.COM",
        "x-workspace-id": "attacker",
      },
    }),
    {
      environment: {
        VSEE_DEPLOYMENT_MODE: "product",
        VSEE_TRUSTED_AUTH_PROVIDER: "openai_sites",
      },
      memberships: {
        resolvePrimaryMembership: async (userId) => {
          resolvedUserId = userId;
          return { workspaceId: "workspace_real", role: "owner" };
        },
      },
    },
  );

  assert.equal(
    resolvedUserId,
    "openai_sites:ff8d9819fc0e12bf0d24892e45987e249a28dce836a85cad60e28eaaa8c6d976",
  );
  assert.ok(context.principal);
  assert.equal(context.principal.email, "alice@example.com");
  assert.equal(context.workspaceId, "workspace_real");
});

test("product mode rejects unsigned Sites-shaped headers when the provider is disabled", async () => {
  await assert.rejects(
    resolveRequestContext(
      new Request("https://vsee.test/api/deals", {
        headers: {
          "oai-authenticated-user-email": "alice@example.com",
        },
      }),
      {
        environment: { VSEE_DEPLOYMENT_MODE: "product" },
        memberships: {
          resolvePrimaryMembership: async () => ({
            workspaceId: "workspace_real",
            role: "owner",
          }),
        },
      },
    ),
    /UNAUTHENTICATED/,
  );
});

for (const [role, permissions] of [
  ["owner", { readWorkspace: true, readPrivateSources: true, mutateSources: true, managePolicy: true, administerFrameworks: false }],
  ["partner", { readWorkspace: true, readPrivateSources: true, mutateSources: true, managePolicy: false, administerFrameworks: false }],
  ["associate", { readWorkspace: true, readPrivateSources: true, mutateSources: false, managePolicy: false, administerFrameworks: false }],
  ["admin", { readWorkspace: true, readPrivateSources: true, mutateSources: true, managePolicy: true, administerFrameworks: false }],
] as const) {
  test(`workspace ${role} permissions never grant framework administration`, async () => {
    const context = await resolveRequestContext(
      new Request("https://vsee.test/api/deals"),
      productContextFixture({ membership: { workspaceId: "workspace_real", role } }),
    );
    assert.deepEqual(context.permissions, permissions);
  });
}

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
  await assert.rejects(
    resolveRequestContext(new Request("https://vsee.test/api/deals"), {
      environment: { VSEE_DEPLOYMENT_MODE: "public_demo" },
    }),
    /INTERNAL_ERROR/,
  );
});

test("authenticated product mode fails closed when Supabase membership configuration is absent", async () => {
  await assert.rejects(
    resolveRequestContext(new Request("https://vsee.test/api/deals"), {
      environment: { VSEE_DEPLOYMENT_MODE: "product" },
      resolveSession: async () => ({ userId: "user_1", email: "user@example.com" }),
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

  const forbidden = errorResponse(new Error("FORBIDDEN"));
  assert.equal(forbidden.status, 403);
  assert.deepEqual(await forbidden.json(), {
    error: { code: "FORBIDDEN", message: "Access denied", retryable: false },
  });

  const unavailable = errorResponse(new IntegrationTransportError({ retryable: true }));
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), {
    error: { code: "INTEGRATION_UNAVAILABLE", message: "A required service is unavailable", retryable: true },
  });

  const nonRetryableTransport = errorResponse(new IntegrationTransportError({ retryable: false }));
  assert.equal(nonRetryableTransport.status, 500);
  assert.deepEqual(await nonRetryableTransport.json(), {
    error: { code: "INTERNAL_ERROR", message: "Internal server error", retryable: false },
  });

  const unexpected = errorResponse(new Error("postgres://admin:secret@internal.example"));
  assert.equal(unexpected.status, 500);
  assert.deepEqual(await unexpected.json(), {
    error: { code: "INTERNAL_ERROR", message: "Internal server error", retryable: false },
  });
});

test("every public API error envelope conforms to the shared schema", async () => {
  for (const code of [
    "VALIDATION_ERROR",
    "NOT_FOUND",
    "CONFLICT",
    "RATE_LIMITED",
    "INTEGRATION_UNAVAILABLE",
    "UNAUTHENTICATED",
    "FORBIDDEN",
    "INTERNAL_ERROR",
  ] as const) {
    const response = jsonError(code, "A fixed public message", 400);
    assert.equal(ApiErrorSchema.safeParse(await response.json()).success, true, code);
  }
});
