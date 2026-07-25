import assert from "node:assert/strict";
import test from "node:test";

import { createClaudeClient } from "../../lib/claude/client";

test("Claude client defaults to Opus 4.8", async () => {
  const previousModel = process.env.ANTHROPIC_MODEL;
  delete process.env.ANTHROPIC_MODEL;
  let requestBody: Record<string, unknown> | undefined;

  try {
    const client = createClaudeClient({
      apiKey: "test-key",
      fetchImpl: async (_url, init) => {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return Response.json({
          content: [{ type: "text", text: "[]" }],
        });
      },
    });

    await client.complete({
      system: "Return JSON.",
      messages: [{ role: "user", content: "Test" }],
    });

    assert.equal(requestBody?.model, "claude-opus-4-8");
    assert.equal("temperature" in (requestBody ?? {}), false);
  } finally {
    if (previousModel === undefined) delete process.env.ANTHROPIC_MODEL;
    else process.env.ANTHROPIC_MODEL = previousModel;
  }
});

test("Claude client retries once on retryable provider errors", async () => {
  let calls = 0;
  const client = createClaudeClient({
    apiKey: "test-key",
    backoffMs: 1,
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) {
        return new Response("overloaded", { status: 529 });
      }
      return Response.json({ content: [{ type: "text", text: "ok" }] });
    },
  });

  const text = await client.complete({
    system: "Return JSON.",
    messages: [{ role: "user", content: "Test" }],
  });

  assert.equal(text, "ok");
  assert.equal(calls, 2, "a 5xx response must be retried exactly once");
});

test("Claude client does not retry non-retryable request errors", async () => {
  let calls = 0;
  const client = createClaudeClient({
    apiKey: "test-key",
    backoffMs: 1,
    fetchImpl: async () => {
      calls += 1;
      return new Response("bad request", { status: 400 });
    },
  });

  await assert.rejects(
    client.complete({
      system: "Return JSON.",
      messages: [{ role: "user", content: "Test" }],
    }),
    /Anthropic request failed with 400/,
  );
  assert.equal(calls, 1, "a 400 must not be retried");
});

test("Claude client retries once when the request itself fails", async () => {
  let calls = 0;
  const client = createClaudeClient({
    apiKey: "test-key",
    backoffMs: 1,
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) throw new Error("socket hang up");
      return Response.json({ content: [{ type: "text", text: "ok" }] });
    },
  });

  assert.equal(await client.complete({
    system: "Return JSON.",
    messages: [{ role: "user", content: "Test" }],
  }), "ok");
  assert.equal(calls, 2);
});
