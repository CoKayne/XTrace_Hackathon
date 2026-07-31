import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { spawn } from "node:child_process";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const clientOutput = path.join(repositoryRoot, "dist", "client");
if (
  path.basename(clientOutput) !== "client"
  || path.basename(path.dirname(clientOutput)) !== "dist"
) {
  throw new Error("Refusing to clear an unexpected Web build directory.");
}

const npmCli = process.env.npm_execpath;
if (!npmCli) {
  throw new Error("Run this verifier through npm.");
}

const buildStartedAt = Date.now();
await rm(clientOutput, { recursive: true, force: true });
await run(process.execPath, [npmCli, "run", "build"]);
await run(process.execPath, [
  "--import",
  "tsx",
  "--test",
  "--test-concurrency=1",
  "--test-name-pattern=document parsers stay in the Node worker",
  "tests/unit/integration-transport-boundaries.test.ts",
], {
  ...process.env,
  VSEE_VERIFY_FRESH_WEB_BUNDLE: "1",
  VSEE_FRESH_WEB_BUNDLE_STARTED_AT: String(buildStartedAt),
});

function run(command, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      env,
      stdio: "inherit",
    });
    child.once("error", () => {
      reject(new Error("Web parser boundary verification could not start."));
    });
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error("Web parser boundary verification failed."));
      }
    });
  });
}
