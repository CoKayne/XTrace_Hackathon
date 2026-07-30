import assert from "node:assert/strict";
import test from "node:test";

import { resolveAssetDirectory } from "../../build/asset-version";

test("Sites client assets use a source-versioned namespace", () => {
  const first = resolveAssetDirectory({
    readGitRevision: () => "70dc0146cee3",
  });
  const second = resolveAssetDirectory({
    readGitRevision: () => "9f4cbb0d8a21",
  });

  assert.equal(first, "assets-70dc0146cee3");
  assert.equal(second, "assets-9f4cbb0d8a21");
  assert.notEqual(first, second);
});

test("an explicit deployment version is normalized and takes precedence", () => {
  let gitWasRead = false;
  const directory = resolveAssetDirectory({
    explicitVersion: " Release/2026.07.30 ",
    readGitRevision: () => {
      gitWasRead = true;
      return "70dc0146cee3";
    },
  });

  assert.equal(directory, "assets-release-2026-07-30");
  assert.equal(gitWasRead, false);
});

test("asset version resolution has a stable local fallback", () => {
  assert.equal(
    resolveAssetDirectory({
      readGitRevision: () => {
        throw new Error("not a git checkout");
      },
    }),
    "assets-local",
  );
});

test("production asset version resolution fails closed outside a versioned source tree", () => {
  assert.throws(
    () => resolveAssetDirectory({
      requireVersion: true,
      readGitRevision: () => {
        throw new Error("not a git checkout");
      },
    }),
    /production asset version/i,
  );
});
