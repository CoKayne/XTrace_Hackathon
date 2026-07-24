import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createMemoryDemoDataStore,
  createMemoryPrivateObjectStorage,
} from "../../lib/storage/service";
import { DEMO_DEAL_EVIDENCE } from "../../lib/corpus/evidence";
import { DEMO_FIXTURES } from "../../lib/corpus/fixtures";
import { runDemoSeed } from "../../scripts/seed-demo";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("running the demo seed twice creates zero duplicate runtime records or private objects", async () => {
  const dataStore = createMemoryDemoDataStore();
  const objectStorage = createMemoryPrivateObjectStorage();
  const dependencies = {
    dataStore,
    objectStorage,
    corpusDirectory: path.join(workspaceRoot, "seed", "corpus"),
  };

  const first = await runDemoSeed(dependencies);
  const second = await runDemoSeed(dependencies);
  const snapshot = dataStore.inspect();

  assert.deepEqual(first.created, {
    workspaces: 1,
    users: 1,
    memberships: 1,
    documents: 14,
    workspaceDocuments: 0,
    privateObjects: 14,
    companies: 19,
    deals: 19,
    evidence: DEMO_DEAL_EVIDENCE.length,
    fixtures: DEMO_FIXTURES.length,
  });
  assert.deepEqual(second.created, {
    workspaces: 0,
    users: 0,
    memberships: 0,
    documents: 0,
    workspaceDocuments: 0,
    privateObjects: 0,
    companies: 0,
    deals: 0,
    evidence: 0,
    fixtures: 0,
  });
  assert.equal(snapshot.documents.length, 14);
  assert.equal(
    snapshot.workspaceDocuments.length,
    0,
    "seeded source availability must not count as explicit user confirmation",
  );
  assert.equal(snapshot.companies.length, 19);
  assert.equal(snapshot.deals.length, 19);
  assert.equal(snapshot.evidence.length, DEMO_DEAL_EVIDENCE.length);
  assert.equal(snapshot.fixtures.length, DEMO_FIXTURES.length);
  assert.ok(snapshot.fixtures.every((fixture) => fixture.provenance === "demo_fixture"));
  assert.ok(snapshot.fixtures.every(
    (fixture) => fixture.label === "Synthetic VC decision record created for the hackathon demo",
  ));
  assert.equal(objectStorage.inspect().length, 14);
});
