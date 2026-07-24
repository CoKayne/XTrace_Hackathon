import assert from "node:assert/strict";
import test from "node:test";

import { decisionReasonLabel } from "../../lib/demo/decision-label";

test("decision reason labels reflect the Deal status", () => {
  assert.equal(decisionReasonLabel("passed"), "Pass reason");
  assert.equal(decisionReasonLabel("invested"), "Investment rationale");
  assert.equal(decisionReasonLabel("screening"), "Decision reason");
  assert.equal(decisionReasonLabel("watchlist"), "Decision reason");
  assert.equal(decisionReasonLabel("evaluating"), "Decision reason");
});
