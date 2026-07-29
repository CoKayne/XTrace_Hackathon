import Decimal from "decimal.js";

import type {
  EvidenceConflict,
  Fact,
} from "../../contracts/evidence";

export interface MaterialityRule {
  id: string;
  field: string;
  absoluteTolerance: string;
  relativeTolerance: string;
}

export interface ConflictResolution {
  leftFactId: string;
  rightFactId: string;
  resolutionFactId: string;
  reason: string;
}

export const DEFAULT_MATERIALITY_RULES: MaterialityRule[] = [
  rule("arr", "0", "0.05"),
  rule("revenue", "0", "0.05"),
  rule("recurring_revenue", "0", "0.05"),
  rule("services_revenue", "0", "0.05"),
  rule("pass_through_revenue", "0", "0.05"),
  rule("reported_valuation", "0", "0.01"),
  rule("growth", "0.01", "0.05"),
];

export function buildEvidenceConflicts(
  facts: readonly Fact[],
  rules: readonly MaterialityRule[],
  resolutions: readonly ConflictResolution[] = [],
): EvidenceConflict[] {
  const sorted = [...facts].sort((left, right) =>
    compareUtf8(left.id, right.id)
  );
  const conflicts: EvidenceConflict[] = [];
  for (let leftIndex = 0; leftIndex < sorted.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < sorted.length;
      rightIndex += 1
    ) {
      const left = sorted[leftIndex]!;
      const right = sorted[rightIndex]!;
      if (!areComparable(left, right) || left.value === right.value) continue;
      const selectedRule = rules.find(({ field }) => field === left.field)
        ?? exactRule(left.field);
      const material = isMaterialDifference(left, right, selectedRule);
      const resolution = resolutions.find((candidate) =>
        samePair(
          left.id,
          right.id,
          candidate.leftFactId,
          candidate.rightFactId,
        )
      );
      conflicts.push({
        id: [
          "conflict",
          left.field,
          left.id,
          right.id,
          selectedRule.id,
        ].join(":"),
        field: left.field,
        leftFactId: left.id,
        rightFactId: right.id,
        materialityRuleId: selectedRule.id,
        material,
        status: resolution
          ? "resolved"
          : material
          ? "open"
          : "immaterial",
        resolutionFactId: resolution?.resolutionFactId ?? null,
        resolutionReason: resolution?.reason
          ?? (material
            ? null
            : `Difference is within ${selectedRule.id}.`),
      });
    }
  }
  return conflicts;
}

function areComparable(left: Fact, right: Fact): boolean {
  return left.field === right.field
    && left.unit === right.unit
    && left.currency === right.currency
    && left.periodStart === right.periodStart
    && left.periodEnd === right.periodEnd;
}

function isMaterialDifference(
  left: Fact,
  right: Fact,
  selectedRule: MaterialityRule,
): boolean {
  let leftValue: Decimal;
  let rightValue: Decimal;
  try {
    leftValue = new Decimal(left.value);
    rightValue = new Decimal(right.value);
  } catch {
    return left.value !== right.value;
  }
  const difference = leftValue.minus(rightValue).abs();
  const relativeBase = Decimal.max(leftValue.abs(), rightValue.abs());
  const tolerance = Decimal.max(
    new Decimal(selectedRule.absoluteTolerance),
    relativeBase.times(selectedRule.relativeTolerance),
  );
  return difference.greaterThan(tolerance);
}

function rule(
  field: string,
  absoluteTolerance: string,
  relativeTolerance: string,
): MaterialityRule {
  return {
    id: `${field}_materiality_v1`,
    field,
    absoluteTolerance,
    relativeTolerance,
  };
}

function exactRule(field: string): MaterialityRule {
  return {
    id: `${field}_exact_materiality_v1`,
    field,
    absoluteTolerance: "0",
    relativeTolerance: "0",
  };
}

function samePair(
  left: string,
  right: string,
  candidateLeft: string,
  candidateRight: string,
): boolean {
  return (left === candidateLeft && right === candidateRight)
    || (left === candidateRight && right === candidateLeft);
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}
