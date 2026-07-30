import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the VSee investor workflow shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>VSee — VC Decision Intelligence<\/title>/i);
  assert.match(html, /VC DECISION INTELLIGENCE/);
  assert.match(html, /WAKE AGENT (?:&amp;|&) SCAN MARKET/);
  for (const label of [
    "Overview",
    "Deals",
    "Sources",
    "Fund Policy",
    "Market",
    "Reports",
    "Chat",
    "Settings",
  ]) {
    assert.match(html, new RegExp(`Open ${label}`));
  }
  assert.doesNotMatch(html, /aria-label="Open Runs"/);
  assert.match(html, /Loading workspace evidence/);
  assert.match(
    html,
    /\/assets-[a-z0-9-]+\/page-[A-Za-z0-9_-]+\.js/,
    "client assets must live under a release-specific path",
  );
});

test("keeps company intelligence and responsive hierarchy in the production source", async () => {
  const [page, company, progress, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/company-intelligence.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/scan-progress.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/vsee.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /CompanyIntelligenceReport/);
  assert.match(page, /System activity/);
  assert.doesNotMatch(page, /\{ view: "runs", label: "Runs"/);
  assert.match(progress, /Comparing evidence across eligible companies/);

  for (const label of [
    "THEN / INVESTMENT MEMORY",
    "NOW / MARKET EVIDENCE",
    "RECOMMENDED NEXT MOVE",
    "IC Snapshot",
    "Traction",
    "Deal Terms",
    "Risks",
    "Decision History",
    "Source Lineage",
    "Not available in current evidence",
  ]) {
    assert.match(company, new RegExp(label.replace("/", "\\/")));
  }

  assert.match(css, /\.vsee-priority-grid/);
  assert.match(css, /\.vsee-company-analysis-rows>button:focus-visible/);
  assert.match(css, /@media\(max-width:1040px\).*\.vsee-priority-grid\{grid-template-columns:1fr\}/s);
  assert.match(css, /\.vsee-company-brief-card>nav\{display:flex;overflow-x:auto/);
});
