import assert from "node:assert/strict";
import test from "node:test";

import {
  rateLimitRequest,
  takePublicRequest,
} from "../../lib/api/safety";

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
