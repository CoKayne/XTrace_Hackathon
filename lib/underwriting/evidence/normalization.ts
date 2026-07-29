import Decimal from "decimal.js";

import type {
  SourceEvidenceInput,
} from "../../../db/repositories/evidence-packs";
import {
  FactSchema,
  type Fact,
} from "../../contracts/evidence";

const FIELD_ALIASES: Readonly<Record<string, string>> = {
  "annual recurring revenue": "arr",
  arr: "arr",
  "sales pipeline": "pipeline",
  pipeline: "pipeline",
  "gross merchandise value": "gmv",
  gmv: "gmv",
  "total revenue": "revenue",
  revenue: "revenue",
  "recurring revenue": "recurring_revenue",
  "subscription revenue": "recurring_revenue",
  "professional services revenue": "services_revenue",
  "services revenue": "services_revenue",
  "pass through revenue": "pass_through_revenue",
  "pass-through revenue": "pass_through_revenue",
  "yoy growth": "growth",
  "year over year growth": "growth",
  growth: "growth",
  "company identity": "company_identity",
  "company id": "company_identity",
  "pre money valuation": "reported_valuation",
  "pre-money valuation": "reported_valuation",
  "post money valuation": "reported_valuation",
  "post-money valuation": "reported_valuation",
  "reported valuation": "reported_valuation",
  "round price": "reported_valuation",
  "valuation basis": "reported_valuation_basis",
};

const FINANCIAL_FIELDS = new Set([
  "arr",
  "pipeline",
  "gmv",
  "revenue",
  "recurring_revenue",
  "services_revenue",
  "pass_through_revenue",
  "reported_valuation",
]);

export function normalizeMetricField(field: string): string {
  const normalized = requiredText(field, "An evidence field")
    .toLowerCase()
    .replace(/[_/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return FIELD_ALIASES[normalized]
    ?? normalized.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

export function normalizeSourceEvidence(
  input: SourceEvidenceInput,
): Fact {
  const field = normalizeMetricField(input.field);
  let value = requiredText(input.value, "An evidence value");
  let unit = input.unit?.trim().toLowerCase() || null;
  let currency = input.currency?.trim().toUpperCase() || null;

  if (unit === "percent" || value.endsWith("%")) {
    value = normalizeDecimal(value.replace(/%$/, "").trim())
      .dividedBy(100)
      .toString();
    unit = "decimal";
    currency = null;
  } else if (
    FINANCIAL_FIELDS.has(field)
    || unit === "currency"
    || currency !== null
  ) {
    value = normalizeDecimal(value).toString();
    unit = unit ?? "currency";
    if (!currency || !/^[A-Z]{3}$/.test(currency)) {
      throw new Error(
        `Currency-bearing evidence ${input.id} requires an ISO currency.`,
      );
    }
  } else if (
    unit === "decimal"
    || unit === "rate"
    || unit === "multiple"
  ) {
    value = normalizeDecimal(value).toString();
    unit = unit === "rate" ? "decimal" : unit;
    currency = null;
  } else if (field === "reported_valuation_basis") {
    value = value.toLowerCase().replace(/[-\s]+/g, "_");
  }

  return FactSchema.parse({
    id: requiredText(input.id, "An evidence id"),
    analysisType: "fact",
    provenanceOrigin: input.provenanceOrigin,
    field,
    value,
    unit,
    currency,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    publishedAt: input.publishedAt,
    eventAt: input.eventAt,
    retrievedAt: input.retrievedAt,
    sourceRevisionId: input.sourceRevisionId,
    locator: input.locator,
    sourceRole: input.sourceRole,
    assertionStatus: input.assertionStatus,
    verificationMethod: input.verificationMethod,
    freshness: input.freshness,
    acceptedForGate: input.acceptedForGate,
  });
}

function normalizeDecimal(value: string): Decimal {
  let normalized = value.trim();
  const negativeParentheses =
    normalized.startsWith("(") && normalized.endsWith(")");
  if (negativeParentheses) normalized = normalized.slice(1, -1);
  normalized = normalized
    .replace(/[$€£¥,\s]/g, "")
    .replace(/(?:usd|eur|gbp|jpy)$/i, "");
  if (negativeParentheses) normalized = `-${normalized}`;
  try {
    return new Decimal(normalized);
  } catch {
    throw new Error(`Expected a finite decimal value, received ${value}.`);
  }
}

function requiredText(value: string, label: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}
