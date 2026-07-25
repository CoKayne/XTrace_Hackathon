import assert from "node:assert/strict";
import test from "node:test";

import { buildDemoViewModel } from "../../lib/demo/view-model";

test("demo view model is built from the fixed real corpus", () => {
  const model = buildDemoViewModel();

  assert.equal(model.stats.deals, 19);
  assert.equal(model.stats.marketReports, 4);
  assert.equal(model.stats.referenceDocuments, 1);
  assert.deepEqual(new Set(model.deals.map((deal) => deal.companyName)), new Set([
    "100Plus",
    "1906",
    "7bridges",
    "A-Champs",
    "Ably",
    "Acin",
    "Acquco",
    "Ada Health",
    "Alpha Builders",
    "CouPro",
    "Fellowtrip",
    "HuMetric",
    "IndieShow",
    "INNFormNest",
    "InterTwin.ai",
    "Kanesh",
    "Mirror",
    "SilverMemory",
    "UniKudo",
  ]));
  assert.equal(model.deals.some((deal) => deal.companyName === "Asteria Bio"), false);
});

test("synthetic investment state remains visibly labeled", () => {
  const model = buildDemoViewModel();
  const fixtureDeals = model.deals.filter((deal) => deal.fixture);

  assert.equal(model.stats.fixtureDeals, 19);
  assert.equal(fixtureDeals.length, 19);
  for (const deal of fixtureDeals) {
    assert.equal(deal.fixture?.provenance, "demo_fixture");
    assert.match(deal.fixture?.label ?? "", /Sample decision record/);
    assert.ok(deal.fixture?.decisionReason.trim());
  }
});

test("reference-only document is excluded from importable product inputs", () => {
  const model = buildDemoViewModel();

  assert.equal(model.documents.filter((document) => document.importable).length, 13);
  assert.equal(
    model.documents.find((document) => document.role === "reference")?.importable,
    false,
  );
});
