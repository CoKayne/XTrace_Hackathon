import assert from "node:assert/strict";
import test from "node:test";

import {
  rateLimitRequest,
  requirePermission,
  takePublicRequest,
} from "../../lib/api/safety";
import type { AuthorizedRequestContext } from "../../lib/auth/request-context";

test("public request limiter rejects calls beyond the scoped window", () => {
  let current = 1_000;
  const input = {
    scope: "chat",
    clientId: "203.0.113.10",
    limit: 2,
    windowMs: 60_000,
    now: () => current,
  };
  assert.equal(takePublicRequest(input).allowed, true);
  assert.equal(takePublicRequest(input).allowed, true);
  const blocked = takePublicRequest(input);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds >= 1);
  current += 60_001;
  assert.equal(takePublicRequest(input).allowed, true);
});

test("deployed request limiting uses the persistent PostgreSQL function", async () => {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const result = await rateLimitRequest(
    new Request("https://demo.example/api/chat", {
      headers: { "cf-connecting-ip": "203.0.113.10" },
    }),
    "chat",
    20,
    60_000,
    {
      environment: {
        NODE_ENV: "production",
        SUPABASE_URL: "https://database.example",
        SUPABASE_SERVICE_ROLE_KEY: "server-only",
      },
      fetchImpl: async (url, init) => {
        calls.push({
          url: String(url),
          body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        });
        return Response.json([{ allowed: false, retry_after_seconds: 17 }]);
      },
    },
  );

  assert.deepEqual(result, { allowed: false, retryAfterSeconds: 17 });
  assert.equal(
    calls[0].url,
    "https://database.example/rest/v1/rpc/take_public_request",
  );
  assert.equal(calls[0].body.p_scope, "chat");
  assert.equal(calls[0].body.p_limit, 20);
  assert.match(String(calls[0].body.p_client_hash), /^[a-f0-9]{64}$/);
  assert.notEqual(calls[0].body.p_client_hash, "203.0.113.10");
});

test("persistent request limiting fails closed when its transport rejects", async () => {
  const secret = "rate-limit-secret: connection reset";
  const result = await rateLimitRequest(
    new Request("https://demo.example/api/chat", {
      headers: { "cf-connecting-ip": "203.0.113.11" },
    }),
    "chat",
    20,
    60_000,
    {
      environment: {
        NODE_ENV: "production",
        SUPABASE_URL: "https://database.example",
        SUPABASE_SERVICE_ROLE_KEY: "server-only",
      },
      fetchImpl: async () => {
        throw new TypeError(secret);
      },
    },
  );

  assert.deepEqual(result, { allowed: false, retryAfterSeconds: 60 });
  assert.doesNotMatch(JSON.stringify(result), /rate-limit-secret/i);
});

test("product request limiting keys by the authorized principal and workspace", async () => {
  const hashes: string[] = [];
  const environment = {
    NODE_ENV: "production",
    SUPABASE_URL: "https://database.example",
    SUPABASE_SERVICE_ROLE_KEY: "server-only",
  };
  const fetchImpl: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    hashes.push(String(body.p_client_hash));
    return Response.json([{ allowed: true, retry_after_seconds: 0 }]);
  };
  const baseContext: AuthorizedRequestContext = {
    mode: "product",
    principal: { userId: "user_1", email: "one@example.test" },
    workspaceId: "workspace_one",
    role: "partner",
    permissions: {
      readWorkspace: true,
      readPrivateSources: true,
      mutateSources: true,
      managePolicy: false,
      administerFrameworks: false,
    },
  };
  const forgedRequest = new Request(
    "https://demo.example/api/runs?workspaceId=workspace_attacker",
    {
      headers: {
        "cf-connecting-ip": "203.0.113.44",
        "x-workspace-id": "workspace_attacker",
        cookie: "workspaceId=workspace_attacker",
      },
    },
  );

  await rateLimitRequest(forgedRequest, "run-scan", 5, 60_000, {
    environment,
    fetchImpl,
    context: baseContext,
  });
  await rateLimitRequest(forgedRequest, "run-scan", 5, 60_000, {
    environment,
    fetchImpl,
    context: {
      ...baseContext,
      principal: { userId: "user_2", email: "two@example.test" },
    },
  });
  await rateLimitRequest(forgedRequest, "run-scan", 5, 60_000, {
    environment,
    fetchImpl,
    context: {
      ...baseContext,
      workspaceId: "workspace_two",
    },
  });

  assert.equal(new Set(hashes).size, 3);
  assert.ok(hashes.every((hash) => /^[a-f0-9]{64}$/.test(hash)));
  assert.doesNotMatch(hashes.join(" "), /workspace_attacker|203\\.0\\.113\\.44/);
});

test("requirePermission rejects a missing explicit capability", () => {
  const context: AuthorizedRequestContext = {
    mode: "public_demo",
    principal: null,
    workspaceId: "workspace_demo",
    role: "demo",
    permissions: {
      readWorkspace: true,
      readPrivateSources: false,
      mutateSources: false,
      managePolicy: false,
      administerFrameworks: false,
    },
  };

  assert.doesNotThrow(() => requirePermission(context, "readWorkspace"));
  assert.throws(
    () => requirePermission(context, "readPrivateSources"),
    /FORBIDDEN/,
  );
});
