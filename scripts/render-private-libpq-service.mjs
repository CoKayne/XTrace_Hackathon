#!/usr/bin/env node

import { writeFile } from "node:fs/promises";

const serviceFilePath = process.argv[2];
const passwordFilePath = process.argv[3];

const supportedQueryParameters = new Set([
  "application_name",
  "channel_binding",
  "client_encoding",
  "connect_timeout",
  "gssencmode",
  "keepalives",
  "keepalives_count",
  "keepalives_idle",
  "keepalives_interval",
  "load_balance_hosts",
  "options",
  "require_auth",
  "requirepeer",
  "sslcert",
  "sslcompression",
  "sslcrl",
  "sslcrldir",
  "sslkey",
  "ssl_max_protocol_version",
  "ssl_min_protocol_version",
  "sslmode",
  "sslnegotiation",
  "sslrootcert",
  "sslsni",
  "target_session_attrs",
  "tcp_user_timeout",
]);

function readStandardInput() {
  return new Promise((resolve, reject) => {
    let value = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      value += chunk;
    });
    process.stdin.on("end", () => resolve(value));
    process.stdin.on("error", reject);
  });
}

function decodeUriComponent(value, label) {
  let decoded;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    throw new Error(`Invalid ${label}.`);
  }
  if (/[\0\r\n]/u.test(decoded)) {
    throw new Error(`Invalid ${label}.`);
  }
  return decoded;
}

function assertServiceValue(value, label) {
  if (/[\0\r\n]/u.test(value)) {
    throw new Error(`Invalid ${label}.`);
  }
  return value;
}

function escapePasswordFileValue(value) {
  return value.replaceAll("\\", "\\\\").replaceAll(":", "\\:");
}

async function main() {
  if (!serviceFilePath || !passwordFilePath) {
    throw new Error("Missing private libpq output paths.");
  }

  const rawUri = await readStandardInput();
  if (!rawUri || /[\0\r\n]/u.test(rawUri)) {
    throw new Error("Invalid connection URI.");
  }

  let parsed;
  try {
    parsed = new URL(rawUri);
  } catch {
    throw new Error("Invalid connection URI.");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("Invalid connection URI protocol.");
  }
  if (parsed.hash) {
    throw new Error("Connection URI fragments are unsupported.");
  }

  if (!parsed.hostname || !parsed.username || parsed.pathname.length <= 1) {
    throw new Error(
      "Connection URI must include a hostname, username, and database name.",
    );
  }

  const serviceEntries = [];
  const hostname = parsed.hostname.startsWith("[")
    ? parsed.hostname.slice(1, -1)
    : parsed.hostname;
  serviceEntries.push(["host", assertServiceValue(hostname, "host")]);
  if (parsed.port) {
    serviceEntries.push(["port", assertServiceValue(parsed.port, "port")]);
  }
  serviceEntries.push([
    "user",
    decodeUriComponent(parsed.username, "username"),
  ]);
  serviceEntries.push([
    "dbname",
    decodeUriComponent(parsed.pathname.slice(1), "database name"),
  ]);

  const seenQueryParameters = new Set();
  for (const [key, value] of parsed.searchParams) {
    if (!supportedQueryParameters.has(key) || seenQueryParameters.has(key)) {
      throw new Error("Unsupported or duplicate connection URI parameter.");
    }
    seenQueryParameters.add(key);
    serviceEntries.push([
      key,
      assertServiceValue(value, `connection parameter ${key}`),
    ]);
  }

  const serviceContents = [
    "[vsee-production]",
    ...serviceEntries.map(([key, value]) => `${key}=${value}`),
    "",
  ].join("\n");
  const password = decodeUriComponent(parsed.password, "password");
  const passwordContents = password
    ? `*:*:*:*:${escapePasswordFileValue(password)}\n`
    : "";

  await Promise.all([
    writeFile(serviceFilePath, serviceContents, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    }),
    writeFile(passwordFilePath, passwordContents, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    }),
  ]);
}

main().catch(() => {
  console.error("Could not create private libpq configuration.");
  process.exitCode = 1;
});
