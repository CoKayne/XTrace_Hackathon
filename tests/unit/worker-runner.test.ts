import assert from "node:assert/strict";
import test from "node:test";

import * as workerRunner from "../../worker/runner";

test("a transient worker error backs off instead of terminating the loop", async () => {
  let backoffMs = 0;
  let loggedMessage = "";

  assert.equal(
    typeof workerRunner.runWorkerIteration,
    "function",
    "the worker must expose a recoverable loop iteration",
  );

  await workerRunner.runWorkerIteration({
    runNext: async () => {
      throw new TypeError("fetch failed");
    },
    sleepImpl: async (milliseconds) => {
      backoffMs = milliseconds;
    },
    onError: (message) => {
      loggedMessage = message;
    },
  });

  assert.equal(backoffMs, 2_000);
  assert.match(loggedMessage, /fetch failed/);
});
