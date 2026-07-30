import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeMetricField,
  normalizeSourceEvidence,
} from "../../lib/underwriting/evidence/normalization";
import {
  buildEvidenceConflicts,
  DEFAULT_MATERIALITY_RULES,
} from "../../lib/underwriting/evidence/conflicts";
import type {
  SourceEvidenceInput,
} from "../../db/repositories/evidence-packs";

function input(overrides: Partial<SourceEvidenceInput> = {}): SourceEvidenceInput {
  return {
    id: "fact_1",
    workspaceId: "workspace_1",
    dealId: "deal_1",
    sourceId: "source_1",
    sourceRevisionId: "revision_1",
    provenanceOrigin: "management",
    field: "Annual Recurring Revenue",
    value: "$2,400,000",
    unit: "currency",
    currency: "usd",
    periodStart: "2025-01-01",
    periodEnd: "2025-12-31",
    publishedAt: null,
    eventAt: "2025-12-31T23:59:59.000Z",
    retrievedAt: "2026-07-29T10:00:00.000Z",
    locator: {
      kind: "pdf_page",
      page: 4,
      excerpt: "ARR reached $2.4 million.",
    },
    sourceRole: "management",
    assertionStatus: "reported",
    verificationMethod: null,
    freshness: "current",
    acceptedForGate: true,
    ...overrides,
  };
}

test("normalizes metric definitions without merging economically different values", () => {
  assert.deepEqual(
    [
      "Annual Recurring Revenue",
      "Sales Pipeline",
      "Gross Merchandise Value",
      "Total Revenue",
      "Recurring Revenue",
      "Professional Services Revenue",
      "Pass Through Revenue",
    ].map(normalizeMetricField),
    [
      "arr",
      "pipeline",
      "gmv",
      "revenue",
      "recurring_revenue",
      "services_revenue",
      "pass_through_revenue",
    ],
  );
});

test("normalizes currency and rate values as decimal strings while preserving provenance status", () => {
  const arr = normalizeSourceEvidence(input());
  const growth = normalizeSourceEvidence(input({
    id: "fact_growth",
    field: "YoY Growth",
    value: "40%",
    unit: "percent",
    currency: null,
    assertionStatus: "verified",
    sourceRole: "independent_third_party",
    provenanceOrigin: "public_source",
  }));

  assert.equal(arr.field, "arr");
  assert.equal(arr.value, "2400000");
  assert.equal(arr.currency, "USD");
  assert.equal(growth.field, "growth");
  assert.equal(growth.value, "0.4");
  assert.equal(growth.unit, "decimal");
  assert.equal(growth.assertionStatus, "verified");
  assert.equal(growth.provenanceOrigin, "public_source");
});

test("does not compare facts across incompatible metrics, currencies, or periods", () => {
  const facts = [
    normalizeSourceEvidence(input()),
    normalizeSourceEvidence(input({
      id: "fact_pipeline",
      sourceRevisionId: "revision_2",
      field: "Pipeline",
      value: "$3,000,000",
    })),
    normalizeSourceEvidence(input({
      id: "fact_arr_eur",
      sourceRevisionId: "revision_3",
      value: "2500000",
      currency: "EUR",
    })),
    normalizeSourceEvidence(input({
      id: "fact_arr_next_period",
      sourceRevisionId: "revision_4",
      value: "3000000",
      periodStart: "2026-01-01",
      periodEnd: "2026-12-31",
    })),
  ];

  assert.deepEqual(
    buildEvidenceConflicts(facts, DEFAULT_MATERIALITY_RULES),
    [],
  );
});

test("keeps both conflicting ARR facts and opens one material conflict", () => {
  const facts = [
    normalizeSourceEvidence(input()),
    normalizeSourceEvidence(input({
      id: "fact_arr_verified",
      sourceRevisionId: "revision_2",
      value: "$3,100,000",
      provenanceOrigin: "public_source",
      sourceRole: "independent_third_party",
      assertionStatus: "verified",
      verificationMethod: "audited financial statement",
    })),
  ];

  const conflicts = buildEvidenceConflicts(
    facts,
    DEFAULT_MATERIALITY_RULES,
  );

  assert.equal(facts.length, 2);
  assert.equal(facts[0]?.assertionStatus, "reported");
  assert.equal(facts[1]?.assertionStatus, "verified");
  assert.equal(conflicts.length, 1);
  assert.deepEqual(
    {
      leftFactId: conflicts[0]?.leftFactId,
      rightFactId: conflicts[0]?.rightFactId,
      material: conflicts[0]?.material,
      status: conflicts[0]?.status,
      resolutionFactId: conflicts[0]?.resolutionFactId,
    },
    {
      leftFactId: "fact_1",
      rightFactId: "fact_arr_verified",
      material: true,
      status: "open",
      resolutionFactId: null,
    },
  );
});
