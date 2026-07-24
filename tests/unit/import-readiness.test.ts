import assert from "node:assert/strict";
import test from "node:test";

import {
  createProductInputGate,
  getProductInputReadiness,
} from "../../lib/corpus/import-readiness";
import { listPreloadedDocuments } from "../../lib/corpus/manifest";
import { createMemoryDemoDataStore } from "../../lib/storage/service";

test("product-input readiness is derived from durable workspace-document records", async () => {
  const store = createMemoryDemoDataStore();
  const productInputs = listPreloadedDocuments()
    .filter((document) => document.role !== "reference");
  const reference = listPreloadedDocuments()
    .find((document) => document.role === "reference");
  assert.equal(productInputs.length, 13);
  assert.ok(reference);

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

  const incomplete = await getProductInputReadiness(store, "workspace_demo");
  assert.equal(incomplete.ready, false);
  assert.equal(incomplete.confirmedCount, 12);
  assert.equal(incomplete.requiredCount, 13);
  assert.deepEqual(incomplete.missingDocumentIds, [productInputs[12].id]);
  await assert.rejects(
    createProductInputGate(store).assertReady("workspace_demo"),
    /12 of 13 product inputs/i,
  );

  await store.ensureWorkspaceDocument({
    workspaceId: "workspace_demo",
    documentId: productInputs[12].id,
  });
  assert.deepEqual(
    await getProductInputReadiness(store, "workspace_demo"),
    {
      ready: true,
      confirmedCount: 13,
      requiredCount: 13,
      missingDocumentIds: [],
    },
  );
  await createProductInputGate(store).assertReady("workspace_demo");
});
