import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dockerfilePath = new URL("../../Dockerfile.worker", import.meta.url);
const packagePath = new URL("../../package.json", import.meta.url);
const readmePath = new URL("../../README.md", import.meta.url);

test("worker image has a non-root long-running command and health check", async () => {
  const dockerfile = await readFile(dockerfilePath, "utf8");

  assert.match(dockerfile, /^FROM node:22[\w.-]*-bookworm-slim/m);
  assert.match(dockerfile, /^USER node$/m);
  assert.match(dockerfile, /^HEALTHCHECK\b/m);
  assert.match(dockerfile, /npm",\s*"run",\s*"worker:health"/);
  assert.match(dockerfile, /^CMD \["npm",\s*"run",\s*"worker"\]$/m);
});

test("worker build context includes every seed and research runtime import", async () => {
  const dockerfile = await readFile(dockerfilePath, "utf8");

  assert.match(
    dockerfile,
    /^COPY --chown=node:node seed\/underwriting \.\/seed\/underwriting$/m,
  );
  assert.match(
    dockerfile,
    /^COPY --chown=node:node research\/framework-authoring \.\/research\/framework-authoring$/m,
  );
});

test("worker scripts and production runbook stay documented", async () => {
  const [packageText, readme] = await Promise.all([
    readFile(packagePath, "utf8"),
    readFile(readmePath, "utf8"),
  ]);
  const packageJson = JSON.parse(packageText) as {
    scripts?: Record<string, string>;
  };

  assert.equal(packageJson.scripts?.worker, "tsx worker/runner.ts");
  assert.equal(
    packageJson.scripts?.["worker:health"],
    "node --import tsx worker/health.ts",
  );
  assert.match(readme, /docker build -f Dockerfile\.worker/i);
  assert.match(readme, /fail(?:s)? closed/i);
  assert.match(readme, /worker:health/i);
});
