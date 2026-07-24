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
  } finally {
    if (previousModel === undefined) delete process.env.ANTHROPIC_MODEL;
    else process.env.ANTHROPIC_MODEL = previousModel;
  }
});
