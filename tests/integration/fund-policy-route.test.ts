import assert from "node:assert/strict";
import test from "node:test";

import { GET, PATCH } from "../../app/api/fund-policy/route";
import { POST as applyRecommended } from "../../app/api/fund-policy/apply-recommended/route";
import {
  GET as listVersions,
  POST as restoreVersion,
} from "../../app/api/fund-policy/versions/route";
import {
  createMemoryUnderwritingReferencesRepository,
} from "../../db/repositories/underwriting-references";
import type { AuthorizedRequestContext } from "../../lib/auth/request-context";
import { BALANCED_POLICY_VALUES } from "../../seed/underwriting/balanced-policy-v1";

test("Fund Policy routes append custom, recommended, and restored versions", async () => {
  const references = createMemoryUnderwritingReferencesRepository({
    now: () => new Date("2026-07-29T18:00:00.000Z"),
  });
  const dependencies = {
    resolveRequestContext: async () => productOwner(),
    underwritingReferences: references,
  };
  const initial = await GET(request("/api/fund-policy"), undefined, dependencies);
  const initialBody = await initial.json() as { data: { id: string } };
  assert.equal(initial.status, 200);

  const customValues = structuredClone(BALANCED_POLICY_VALUES);
  customValues.initialCheckMax = "5000000";
  const custom = await PATCH(jsonRequest("/api/fund-policy", {
    expectedActiveVersionId: initialBody.data.id,
    values: customValues,
  }), undefined, dependencies);
  const customBody = await custom.json() as { data: { id: string; version: number } };
  assert.equal(custom.status, 200);
  assert.equal(customBody.data.version, 2);

  const recommended = await applyRecommended(
    jsonRequest("/api/fund-policy/apply-recommended", {
      expectedActiveVersionId: customBody.data.id,
    }),
    undefined,
    dependencies,
  );
  const recommendedBody = await recommended.json() as {
    data: {
      snapshot: { version: number };
      overwrittenDiff: Array<{ field: string }>;
    };
  };
  assert.equal(recommended.status, 200);
  assert.equal(recommendedBody.data.snapshot.version, 3);
  assert.deepEqual(
    recommendedBody.data.overwrittenDiff.map((item) => item.field),
    ["initialCheckMax"],
  );

  const restored = await restoreVersion(
    jsonRequest("/api/fund-policy/versions", {
      versionId: customBody.data.id,
    }),
    undefined,
    dependencies,
  );
  const restoredBody = await restored.json() as { data: { version: number } };
  assert.equal(restored.status, 200);
  assert.equal(restoredBody.data.version, 4);

  const versions = await listVersions(
    request("/api/fund-policy/versions"),
    undefined,
    dependencies,
  );
  const versionsBody = await versions.json() as {
    data: Array<Record<string, unknown>>;
  };
  assert.deepEqual(
    versionsBody.data.map((snapshot) => snapshot.version),
    [4, 3, 2, 1],
  );
  assert.doesNotMatch(
    JSON.stringify(versionsBody),
    /privateBody|objectKey|licensed framework body|service.role/i,
  );
});

test("public demo can read the recommended policy but cannot mutate it", async () => {
  const references = createMemoryUnderwritingReferencesRepository();
  const dependencies = {
    resolveRequestContext: async () => publicDemo(),
    underwritingReferences: references,
  };

  assert.equal(
    (await GET(request("/api/fund-policy"), undefined, dependencies)).status,
    200,
  );
  assert.equal(
    (await applyRecommended(
      jsonRequest("/api/fund-policy/apply-recommended", {
        expectedActiveVersionId: null,
      }),
      undefined,
      dependencies,
    )).status,
    403,
  );
  assert.equal(
    (await PATCH(
      jsonRequest("/api/fund-policy", {
        expectedActiveVersionId: null,
        values: BALANCED_POLICY_VALUES,
      }),
      undefined,
      dependencies,
    )).status,
    403,
  );
});

function productOwner(): AuthorizedRequestContext {
  return {
    mode: "product",
    principal: {
      userId: "user_owner",
      email: "owner@example.test",
    },
    workspaceId: "workspace_one",
    role: "owner",
    permissions: {
      readWorkspace: true,
      readPrivateSources: true,
      mutateSources: true,
      managePolicy: true,
      administerFrameworks: false,
    },
  };
}

function publicDemo(): AuthorizedRequestContext {
  return {
    mode: "public_demo",
    principal: null,
    workspaceId: "workspace_demo",
    role: "demo",
    permissions: {
      readWorkspace: true,
      readPrivateSources: false,
      mutateSources: false,
      managePolicy: false,
      administerFrameworks: false,
    },
  };
}

function request(path: string, init: RequestInit = {}): Request {
  return new Request(`https://example.test${path}`, init);
}

function jsonRequest(path: string, body: unknown): Request {
  return request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
