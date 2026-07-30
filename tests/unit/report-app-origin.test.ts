import assert from "node:assert/strict";
import test from "node:test";

import { GET as getHealth } from "../../app/api/settings/health/route";
import { resolveReportAppOrigin } from "../../app/ui-capabilities";
import type { AuthorizedRequestContext } from "../../lib/auth/request-context";

const permissions: AuthorizedRequestContext["permissions"] = {
  readWorkspace: true,
  readPrivateSources: false,
  mutateSources: false,
  managePolicy: false,
  administerFrameworks: false,
};

test("public demo report links use the configured canonical HTTPS origin", () => {
  assert.equal(
    resolveReportAppOrigin({
      deploymentMode: "public_demo",
      canonicalAppOrigin: "https://vsee.example/",
      browserOrigin: "https://legacy-worker.example",
    }),
    "https://vsee.example",
  );
});

test("product and unconfigured local sessions preserve the browser origin", () => {
  assert.equal(
    resolveReportAppOrigin({
      deploymentMode: "product",
      canonicalAppOrigin: "https://vsee.example",
      browserOrigin: "https://tenant.example",
    }),
    "https://tenant.example",
  );
  assert.equal(
    resolveReportAppOrigin({
      deploymentMode: "public_demo",
      browserOrigin: "http://localhost:3000",
    }),
    "http://localhost:3000",
  );
});

test("public demo report links ignore unsafe or malformed canonical origins", () => {
  const browserOrigin = "https://current.example";

  for (const canonicalAppOrigin of [
    "javascript:alert(1)",
    "https://user:secret@vsee.example",
    "http://vsee.example",
    "https://vsee.example/path",
    "https://vsee.example/?query=1",
    "https://vsee.example/#fragment",
    "not a URL",
  ]) {
    assert.equal(
      resolveReportAppOrigin({
        deploymentMode: "public_demo",
        canonicalAppOrigin,
        browserOrigin,
      }),
      browserOrigin,
      canonicalAppOrigin,
    );
  }
});

test("local HTTP remains a valid explicit public-demo origin", () => {
  assert.equal(
    resolveReportAppOrigin({
      deploymentMode: "public_demo",
      canonicalAppOrigin: "http://localhost:4173/",
      browserOrigin: "http://127.0.0.1:3000",
    }),
    "http://localhost:4173",
  );
});

test("public demo health exposes the configured canonical origin", async () => {
  const previousPublicAppUrl = process.env.PUBLIC_APP_URL;
  process.env.PUBLIC_APP_URL = "https://vsee.example/";
  try {
    const response = await getHealth(
      new Request("http://legacy-worker.example/api/settings/health"),
      undefined,
      {
        resolveRequestContext: async () => ({
          mode: "public_demo",
          principal: null,
          workspaceId: "workspace_demo",
          role: "demo",
          permissions,
        }),
      },
    );
    const body = await response.json() as {
      data: { canonicalAppOrigin?: string };
    };

    assert.equal(body.data.canonicalAppOrigin, "https://vsee.example");
  } finally {
    if (previousPublicAppUrl === undefined) delete process.env.PUBLIC_APP_URL;
    else process.env.PUBLIC_APP_URL = previousPublicAppUrl;
  }
});

test("product health never exposes the public-demo canonical origin", async () => {
  const previousPublicAppUrl = process.env.PUBLIC_APP_URL;
  process.env.PUBLIC_APP_URL = "https://vsee.example";
  try {
    const response = await getHealth(
      new Request("https://tenant.example/api/settings/health"),
      undefined,
      {
        resolveRequestContext: async () => ({
          mode: "product",
          principal: {
            userId: "owner_1",
            email: "owner@example.test",
          },
          workspaceId: "workspace_1",
          role: "owner",
          permissions: {
            ...permissions,
            readPrivateSources: true,
            mutateSources: true,
            managePolicy: true,
          },
        }),
      },
    );
    const body = await response.json() as {
      data: { canonicalAppOrigin?: string };
    };

    assert.equal(body.data.canonicalAppOrigin, undefined);
  } finally {
    if (previousPublicAppUrl === undefined) delete process.env.PUBLIC_APP_URL;
    else process.env.PUBLIC_APP_URL = previousPublicAppUrl;
  }
});
