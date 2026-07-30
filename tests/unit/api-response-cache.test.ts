import assert from "node:assert/strict";
import test from "node:test";

import {
  jsonCreated,
  jsonError,
  jsonOk,
} from "../../lib/api/response";

test("JSON API responses are private and never stored by deployment caches", () => {
  for (const response of [
    jsonOk({ ok: true }),
    jsonCreated({ id: "created" }),
    jsonError("FORBIDDEN", "Access denied", 403),
  ]) {
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
});

test("jsonOk keeps caller headers while enforcing the no-store policy", () => {
  const response = jsonOk(
    { ok: true },
    { headers: { "x-test-header": "preserved", "cache-control": "public" } },
  );

  assert.equal(response.headers.get("x-test-header"), "preserved");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});
