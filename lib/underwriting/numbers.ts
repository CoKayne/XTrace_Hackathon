import Decimal from "decimal.js";

import type { DecimalString } from "../contracts/evidence";

const decimalPattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

const AuthoritativeDecimal = Decimal.clone({
  precision: 40,
  rounding: Decimal.ROUND_HALF_EVEN,
});

function parseDecimalString(value: string): InstanceType<typeof Decimal> {
  if (typeof value !== "string" || !decimalPattern.test(value)) {
    throw new TypeError("Expected a finite decimal string");
  }

  const parsed = new AuthoritativeDecimal(value);
  if (!parsed.isFinite()) {
    throw new RangeError("Expected a finite decimal string");
  }
  return parsed;
}

function toDecimalString(value: InstanceType<typeof Decimal>): DecimalString {
  if (!value.isFinite()) {
    throw new RangeError("Decimal result must be finite");
  }
  return (value.isZero() ? "0" : value.toFixed()) as DecimalString;
}

export function normalizeDecimalString(value: string): DecimalString {
  return toDecimalString(parseDecimalString(value));
}

export function requireNonNegativeDecimalString(
  value: string,
): DecimalString {
  const parsed = parseDecimalString(value);
  if (parsed.isNegative() && !parsed.isZero()) {
    throw new RangeError("Expected a non-negative decimal string");
  }
  return toDecimalString(parsed);
}

export function requirePositiveDecimalString(value: string): DecimalString {
  const parsed = parseDecimalString(value);
  if (!parsed.isPositive() || parsed.isZero()) {
    throw new RangeError("Expected a positive decimal string");
  }
  return toDecimalString(parsed);
}

export function addDecimalStrings(
  left: string,
  right: string,
): DecimalString {
  return toDecimalString(parseDecimalString(left).plus(parseDecimalString(right)));
}

export function subtractDecimalStrings(
  left: string,
  right: string,
): DecimalString {
  return toDecimalString(
    parseDecimalString(left).minus(parseDecimalString(right)),
  );
}

export function multiplyDecimalStrings(
  left: string,
  right: string,
): DecimalString {
  return toDecimalString(
    parseDecimalString(left).times(parseDecimalString(right)),
  );
}

export function divideDecimalStrings(
  numerator: string,
  denominator: string,
): DecimalString {
  const divisor = parseDecimalString(denominator);
  if (divisor.isZero()) {
    throw new RangeError("Cannot divide by zero");
  }
  return toDecimalString(parseDecimalString(numerator).dividedBy(divisor));
}

export function roundDecimalStringForDisplay(
  value: string,
  decimalPlaces: number,
): DecimalString {
  if (!Number.isInteger(decimalPlaces) || decimalPlaces < 0) {
    throw new RangeError("Display decimal places must be a non-negative integer");
  }
  return parseDecimalString(value).toFixed(
    decimalPlaces,
    AuthoritativeDecimal.ROUND_HALF_EVEN,
  ) as DecimalString;
}
