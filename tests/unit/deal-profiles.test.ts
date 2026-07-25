import assert from "node:assert/strict";
import test from "node:test";

import {
  SAMPLE_DEAL_PROFILES,
  SAMPLE_DEAL_PROFILE_LABEL,
} from "../../app/deal-profiles";
import { buildPreloadedDealMemoryBundles } from "../../lib/corpus/service";

test("every sample deal profile is labeled and non-empty", () => {
  const profiles = Object.entries(SAMPLE_DEAL_PROFILES);
  assert.ok(profiles.length >= 1);
  for (const [dealId, profile] of profiles) {
    assert.equal(profile.label, SAMPLE_DEAL_PROFILE_LABEL, dealId);
    assert.ok(profile.traction.length > 0, `${dealId} traction`);
    assert.ok(profile.dealTerms.length > 0, `${dealId} deal terms`);
  }
  assert.ok(SAMPLE_DEAL_PROFILES.deal_1906, "the 1906 demo profile must exist");
});

test("sample deal profiles never enter memory bundles or analysis input", () => {
  // Presentation-only data: it must not reach XTrace ingest, recall queries,
  // or matching input, and it must not perturb judgment fingerprints.
  const serialized = JSON.stringify(buildPreloadedDealMemoryBundles());
  assert.ok(!serialized.includes(SAMPLE_DEAL_PROFILE_LABEL));
  for (const profile of Object.values(SAMPLE_DEAL_PROFILES)) {
    for (const row of [...profile.traction, ...profile.dealTerms]) {
      assert.ok(
        !serialized.includes(row.value),
        `bundle content must not contain profile value "${row.value}"`,
      );
    }
  }
});
