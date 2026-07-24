import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { GET as getHealth } from "../../app/api/settings/health/route";
import { listPreloadedDocuments } from "../../lib/corpus/manifest";
import { createDefaultDemoDataStore } from "../../lib/storage/service";

const pagePath = new URL("../../app/page.tsx", import.meta.url);
const cssPath = new URL("../../app/vsee.css", import.meta.url);
const dialogPath = new URL("../../app/report-draft-dialog.tsx", import.meta.url);

test("health response exposes worker readiness independently from PostgreSQL configuration", async () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  try {
    const response = await getHealth();
    const body = await response.json() as {
      data: { postgres: boolean; worker: boolean; corpusReady: boolean };
    };

    assert.equal(body.data.postgres, false);
    assert.equal(body.data.worker, false);
    assert.equal(body.data.corpusReady, false);
  } finally {
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
  }
});

test("health reports XTrace configured for an mmk key without an organization ID", async () => {
  const previousApiKey = process.env.XTRACE_API_KEY;
  const previousOrgId = process.env.XTRACE_ORG_ID;
  process.env.XTRACE_API_KEY = "mmk_test";
  delete process.env.XTRACE_ORG_ID;

  try {
    const response = await getHealth();
    const body = await response.json() as { data: { xtrace: boolean } };

    assert.equal(body.data.xtrace, true);
  } finally {
    if (previousApiKey === undefined) delete process.env.XTRACE_API_KEY;
    else process.env.XTRACE_API_KEY = previousApiKey;
    if (previousOrgId === undefined) delete process.env.XTRACE_ORG_ID;
    else process.env.XTRACE_ORG_ID = previousOrgId;
  }
});

test("health derives corpus readiness from durable confirmation, not browser state", async () => {
  const store = createDefaultDemoDataStore();
  await store.resetDemoData();
  try {
    for (const document of listPreloadedDocuments()) {
      if (document.role === "reference") continue;
      await store.ensureWorkspaceDocument({
        workspaceId: "workspace_demo",
        documentId: document.id,
      });
    }
    const response = await getHealth();
    const body = await response.json() as {
      data: { corpusReady: boolean; corpusConfirmedCount: number };
    };
    assert.equal(body.data.corpusReady, true);
    assert.equal(body.data.corpusConfirmedCount, 13);
  } finally {
    await store.resetDemoData();
  }
});

test("dashboard keeps scans honest and requires explicit import review", async () => {
  const page = await readFile(pagePath, "utf8");

  assert.match(page, /worker:\s*boolean/);
  assert.match(page, /health\?\.postgres/);
  assert.match(page, /health\.worker/);
  assert.match(page, /health\.anthropic/);
  assert.match(page, /health\.corpusReady/);
  assert.doesNotMatch(page, /localStorage/);
  assert.match(page, /!xtraceEnabled\s*\|\|\s*health\.xtrace/);
  assert.match(page, /\/api\/imports\/preview/);
  assert.match(page, /Confirm company &(?:amp;)? Deal ownership/i);
  assert.match(page, /aria-checked=\{xtraceEnabled\}/);
  assert.match(page, /role="alert"/);
  assert.match(page, /role="status"/);
});

test("dashboard supports report deep links, page anchors, and a two-row mobile nav", async () => {
  const [page, css] = await Promise.all([
    readFile(pagePath, "utf8"),
    readFile(cssPath, "utf8"),
  ]);

  assert.match(page, /searchParams\.get\("view"\)/);
  assert.match(page, /searchParams\.get\("report"\)/);
  assert.match(page, /#page=\$\{source\.page\}/);
  assert.match(page, /No Deals match/i);
  assert.match(css, /grid-template-columns:repeat\(4,1fr\)/);
});

test("reports open an editable internal draft dialog without sending email", async () => {
  const [page, dialog, css] = await Promise.all([
    readFile(pagePath, "utf8"),
    readFile(dialogPath, "utf8"),
    readFile(cssPath, "utf8"),
  ]);

  assert.match(page, /DRAFT THIS REPORT →/);
  assert.match(page, /buildInternalReportDraft/);
  assert.match(dialog, /<dialog/);
  assert.match(dialog, /Subject/);
  assert.match(dialog, /Message/);
  assert.match(dialog, /COPY BODY/);
  assert.match(dialog, /COPY FULL DRAFT/);
  assert.match(dialog, /aria-live="polite"/);
  assert.doesNotMatch(dialog, />To</);
  assert.doesNotMatch(page, /\/api\/reports\/\$\{latestReport\.id\}\/email/);
  assert.doesNotMatch(page, /EMAIL THIS REPORT|EMAIL SENT|SENDING…/);
  assert.match(css, /\.vsee-draft-dialog::backdrop/);
  assert.match(css, new RegExp("@media\\(max-width:680px\\).*\\.vsee-draft-dialog", "s"));
});
