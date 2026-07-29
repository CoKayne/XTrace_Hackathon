import assert from "node:assert/strict";
import test from "node:test";

import {
  addDecimalStrings,
  divideDecimalStrings,
  multiplyDecimalStrings,
  normalizeDecimalString,
  requireNonNegativeDecimalString,
  requirePositiveDecimalString,
  roundDecimalStringForDisplay,
  subtractDecimalStrings,
} from "../../lib/underwriting/numbers";

test("keeps exact decimal arithmetic out of JavaScript Number", () => {
  assert.equal(addDecimalStrings("0.1", "0.2"), "0.3");
  assert.equal(multiplyDecimalStrings("1250000", "0.125"), "156250");
  assert.equal(subtractDecimalStrings("1", "0.9"), "0.1");
  assert.equal(divideDecimalStrings("1", "8"), "0.125");
});

test("normalizes finite decimal strings without losing precision", () => {
  const cases = [
    ["000125.5000", "125.5"],
    ["+0.000", "0"],
    ["-0.000", "0"],
    [".1250", "0.125"],
    ["9007199254740993", "9007199254740993"],
    [
      "12345678901234567890.1234567890123456789",
      "12345678901234567890.1234567890123456789",
    ],
  ] as const;

  for (const [input, expected] of cases) {
    assert.equal(normalizeDecimalString(input), expected);
  }
});

test("rejects non-string, empty, non-finite, exponent, and malformed inputs", () => {
  const invalid: unknown[] = [
    "",
    " ",
    "NaN",
    "Infinity",
    "-Infinity",
    "1e3",
    "0x10",
    "1,000",
    " 1",
    "1 ",
    ".",
    0.1,
    null,
    undefined,
  ];

  for (const input of invalid) {
    assert.throws(() => normalizeDecimalString(input as string));
  }
});

test("uses precision 40 for authoritative arithmetic", () => {
  assert.equal(
    addDecimalStrings(
      "1234567890123456789012345678901234567890",
      "0.1",
    ),
    "1234567890123456789012345678901234567890",
  );
  assert.equal(
    divideDecimalStrings("1", "3"),
    "0.3333333333333333333333333333333333333333",
  );
});

test("rejects zero division and exposes explicit domain guards", () => {
  assert.throws(() => divideDecimalStrings("1", "0"));
  assert.equal(requireNonNegativeDecimalString("0"), "0");
  assert.equal(requireNonNegativeDecimalString("12.5"), "12.5");
  assert.throws(() => requireNonNegativeDecimalString("-0.0001"));
  assert.equal(requirePositiveDecimalString(".0001"), "0.0001");
  assert.throws(() => requirePositiveDecimalString("0"));
  assert.throws(() => requirePositiveDecimalString("-1"));
});

test("keeps half-even display rounding separate from authoritative values", () => {
  assert.equal(normalizeDecimalString("2.345"), "2.345");
  assert.equal(roundDecimalStringForDisplay("2.345", 2), "2.34");
  assert.equal(roundDecimalStringForDisplay("2.355", 2), "2.36");
  assert.equal(roundDecimalStringForDisplay("-2.345", 2), "-2.34");
  assert.equal(roundDecimalStringForDisplay("-2.355", 2), "-2.36");
  assert.throws(() => roundDecimalStringForDisplay("1.2", -1));
  assert.throws(() => roundDecimalStringForDisplay("1.2", 1.5));
});

test("canonicalizes display negative zero while preserving requested scale", () => {
  const cases = [
    ["-0.005", 2, "0.00"],
    ["-0.0049", 2, "0.00"],
    ["-0", 0, "0"],
    ["-0", 3, "0.000"],
    ["-0.0000001", 2, "0.00"],
    ["-0.0000001", 6, "0.000000"],
    ["-0.0000001", 7, "-0.0000001"],
  ] as const;

  for (const [value, scale, expected] of cases) {
    assert.equal(roundDecimalStringForDisplay(value, scale), expected);
  }
});
