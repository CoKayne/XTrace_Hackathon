import assert from "node:assert/strict";
import test from "node:test";

import "../helpers/public-demo";
import { POST as createRun } from "../../app/api/runs/route";
import { getDataClient } from "../../db/client";
import { createRunsRepository } from "../../db/repositories/runs";
import type { RouteDependencies } from "../../lib/api/route-dependencies";
import { listPreloadedDocuments } from "../../lib/corpus/manifest";
import { createDefaultDemoDataStore } from "../../lib/storage/service";

const productPartner: RouteDependencies = {
  async resolveRequestContext() {
    return {
      mode: "product",
      principal: {
        userId: "user_runs_import_gate",
        email: "runs-import-gate@example.test",
      },
      workspaceId: "workspace_demo",
      role: "partner",
      permissions: {
        readWorkspace: true,
        readPrivateSources: true,
        mutateSources: true,
        managePolicy: false,
        administerFrameworks: false,
      },
    };
  },
};

test("POST /api/runs refuses to trust client state until all 13 product inputs are durable", async () => {
  const previousAnthropicKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
  const store = createDefaultDemoDataStore();
  await store.resetDemoData("workspace_demo");
  const productInputs = listPreloadedDocuments()
    .filter((document) => document.role !== "reference");
  const reference = listPreloadedDocuments()
    .find((document) => document.role === "reference");
  assert.equal(productInputs.length, 13);
  assert.ok(reference);
  await createRunsRepository(getDataClient()).touchWorkerHeartbeat(
    "import-gate-test-worker",
  );

  try {
    const request = () => new Request("http://localhost/api/runs", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "198.51.100.42",
      },
      body: JSON.stringify({ xtraceEnabled: false }),
    });
    const emptyResponse = await createRun(request(), undefined, productPartner);
    assert.equal(emptyResponse.status, 409);
    assert.equal((await emptyResponse.json()).error.code, "CONFLICT");

    for (const document of productInputs.slice(0, 12)) {
      await store.ensureWorkspaceDocument({
        workspaceId: "workspace_demo",
        documentId: document.id,
      });
    }
    await store.ensureWorkspaceDocument({
      workspaceId: "workspace_demo",
      documentId: reference.id,
    });
    const incompleteResponse = await createRun(
      request(),
      undefined,
      productPartner,
    );
    assert.equal(incompleteResponse.status, 409);
    assert.match(
      (await incompleteResponse.json()).error.message,
      /12 of 13 product inputs/i,
    );

    await store.ensureWorkspaceDocument({
      workspaceId: "workspace_demo",
      documentId: productInputs[12].id,
    });
    const readyResponse = await createRun(request(), undefined, productPartner);
    assert.equal(readyResponse.status, 201);
  } finally {
    await store.resetDemoData("workspace_demo");
    if (previousAnthropicKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = previousAnthropicKey;
    }
  }
});
