import assert from "node:assert/strict";
import test from "node:test";

import "../helpers/public-demo";
import {
  GET as listRuns,
  POST as createRun,
} from "../../app/api/runs/route";

test("scan creation fails closed when no worker heartbeat is ready", async () => {
  const previousAnthropicKey = process.env.ANTHROPIC_API_KEY;
  const previousSupabaseUrl = process.env.SUPABASE_URL;
  const previousSupabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  try {
    const response = await createRun(new Request("http://localhost/api/runs", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": `test-${crypto.randomUUID()}`,
      },
      body: JSON.stringify({ xtraceEnabled: false }),
    }));
    const body = await response.json() as {
      error?: { code: string; message: string; retryable: boolean };
    };

    assert.equal(response.status, 503);
    assert.equal(body.error?.code, "INTEGRATION_UNAVAILABLE");
    assert.equal(body.error?.retryable, true);
    assert.match(body.error?.message ?? "", /worker/i);

    const queued = await listRuns(
      new Request("http://localhost/api/runs"),
    );
    const queuedBody = await queued.json() as { data: unknown[] };
    assert.deepEqual(queuedBody.data, []);
  } finally {
    if (previousAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previousAnthropicKey;
    if (previousSupabaseUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousSupabaseUrl;
    if (previousSupabaseKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousSupabaseKey;
  }
});
