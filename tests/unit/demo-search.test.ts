import assert from "node:assert/strict";
import test from "node:test";

import { searchDemoEvidence } from "../../lib/demo/search";

test("search returns only evidence already present in the fixed corpus", () => {
  const results = searchDemoEvidence("Why did we mark 7bridges as passed?");

  assert.ok(results.length > 0);
  assert.ok(results.some((item) => item.text.includes("7bridges")));
  assert.ok(results.flatMap((item) => item.sources).every((source) =>
    source.provenance === "source_document" || source.provenance === "demo_fixture"
  ));
});

test("search does not invent an answer for an unknown company", () => {
  assert.deepEqual(searchDemoEvidence("What happened with Asteria Bio?"), []);
});

test("search includes page-cited evidence from the supplied market reports", () => {
  const results = searchDemoEvidence("What does the robotics report say about paying customers?");
  assert.ok(results.some((result) =>
    result.sources.some((source) => source.id === "evidence_robotics_vc_trends_page_4")
  ));
});

test("search ranks an exact combined-PDF company and preserves its page citation", () => {
  const results = searchDemoEvidence("What does Mirror do?");
  assert.ok(results.length > 0);
  assert.equal(results[0].sources[0].id, "evidence_mirror_page_3");
  assert.equal(results[0].sources[0].page, 3);
  assert.equal(
    results.some((result) =>
      result.sources.some((source) => source.id === "evidence_7bridges_page_4")
    ),
    false,
  );
});

test("search does not answer a broad thematic query from partial token overlap", () => {
  assert.deepEqual(
    searchDemoEvidence("Which companies relate to AI infrastructure?"),
    [],
  );
});
