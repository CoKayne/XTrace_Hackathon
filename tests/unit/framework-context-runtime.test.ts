import assert from "node:assert/strict";
import test from "node:test";

import type {
  ResolvedUnderwritingContext,
} from "../../lib/contracts/underwriting";
import {
  RESEARCH_FRAMEWORK_CATALOG_VERSION,
} from "../../lib/underwriting/frameworks/research-loader";
import {
  createContextAwareFrameworkLensResolver,
} from "../../lib/underwriting/frameworks/service";

const context: ResolvedUnderwritingContext = {
  id: "underwriting_context_seed_b2b_saas_v1",
  contextVersion: "1",
  stage: "seed",
  businessModel: "b2b_saas",
  geography: "us",
  securityType: "preferred",
  asOfDate: "2026-07-29",
  criticalEvidenceProfileId: "critical_evidence_seed_b2b_saas_v1",
  benchmarkPackId: "benchmark_pack_synthetic_us_software_v1",
  benchmarkCompatibility: "exact",
  valuationMethodPolicyId: "valuation_method_seed_b2b_saas_v1",
  decisionPolicyId: "decision_policy_seed_b2b_saas_v1",
  frameworkPackId: "framework_pack_synthetic_universal_saas_ai_v1",
};

const execution = {
  provider: "anthropic",
  model: "test-model",
  promptVersion: "framework-lens-v1",
  schemaVersion: "framework-judgment-v1",
  settingsFingerprint: "balanced-underwriting-v1",
  applicationCommit: "framework-context-test",
};

test("caches the exact authorized catalog and service by immutable deal context and catalog version", async () => {
  const resolver = createContextAwareFrameworkLensResolver({
    execution,
    client: {
      async complete() {
        throw new Error("Context resolution must not invoke the provider.");
      },
    },
  });

  const [first, sameSelection] = await Promise.all([
    resolver.resolve(context),
    resolver.resolve({
      ...context,
      id: "same-selection-different-context-id",
      contextVersion: "2",
      asOfDate: "2026-07-30",
    }),
  ]);
  const differentSelections = await Promise.all([
    resolver.resolve({
      ...context,
      id: "underwriting_context_series_a_b2b_saas_v1",
      stage: "series_a",
    }),
    resolver.resolve({
      ...context,
      id: "underwriting_context_seed_enterprise_ai_v1",
      businessModel: "enterprise_ai",
    }),
    resolver.resolve({
      ...context,
      id: "underwriting_context_seed_b2b_saas_global_v1",
      geography: "global",
    }),
  ]);

  assert.strictEqual(sameSelection, first);
  assert.strictEqual(sameSelection.catalog, first.catalog);
  assert.strictEqual(sameSelection.service, first.service);
  assert.equal(first.catalogVersion, RESEARCH_FRAMEWORK_CATALOG_VERSION);
  assert.equal(first.catalog.version, RESEARCH_FRAMEWORK_CATALOG_VERSION);
  assert.equal(first.catalog.fingerprint, first.catalogFingerprint);
  assert.equal(
    first.catalog.authorization.corpusDigest,
    first.corpusDigest,
  );
  assert.equal(new Set([first, ...differentSelections]).size, 4);
  assert.equal(
    new Set([first.catalog, ...differentSelections.map(({ catalog }) =>
      catalog
    )]).size,
    4,
  );
  assert.equal(
    new Set([first.service, ...differentSelections.map(({ service }) =>
      service
    )]).size,
    4,
  );
});
