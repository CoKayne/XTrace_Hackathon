#!/usr/bin/env node

import { createHash } from "node:crypto";

async function readStandardInput() {
  let value = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    value += chunk;
  }
  return value;
}

const value = (await readStandardInput()).trim();
if (!value) {
  console.error("Cannot hash an empty catalog manifest.");
  process.exitCode = 1;
} else {
  const digest = createHash("sha256").update(value, "utf8").digest("hex");
  process.stdout.write(`sha256:${digest}\n`);
}
