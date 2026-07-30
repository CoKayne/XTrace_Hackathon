import assert from "node:assert/strict";
import test from "node:test";

import { resolveTrustedSession } from "../../lib/auth/session";

const providerEnvironment = {
  VSEE_TRUSTED_AUTH_PROVIDER: "openai_sites",
};

test("OpenAI Sites headers are inert unless the trusted provider is explicitly enabled", async () => {
  const request = sitesRequest({
    "oai-authenticated-user-email": "alice@example.com",
  });

  assert.equal(await resolveTrustedSession(request, {}), null);
  assert.equal(
    await resolveTrustedSession(request, {
      VSEE_TRUSTED_AUTH_PROVIDER: "openai",
    }),
    null,
  );
});

test("OpenAI Sites email is canonicalized into a stable non-secret principal id", async () => {
  const principal = await resolveTrustedSession(
    sitesRequest({
      "oai-authenticated-user-email": "Alice@Example.COM",
      "oai-authenticated-user-full-name": "Alice%20Ng",
      "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
    }),
    providerEnvironment,
  );

  assert.deepEqual(principal, {
    userId:
      "openai_sites:ff8d9819fc0e12bf0d24892e45987e249a28dce836a85cad60e28eaaa8c6d976",
    email: "alice@example.com",
    fullName: "Alice Ng",
  });
});

test("workspace-shaped browser input cannot change a trusted Sites principal", async () => {
  const expected = await resolveTrustedSession(
    sitesRequest({
      "oai-authenticated-user-email": "alice@example.com",
    }),
    providerEnvironment,
  );
  const forged = await resolveTrustedSession(
    new Request(
      "https://vsee.test/api/deals?workspaceId=workspace_attacker",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: "workspaceId=workspace_attacker",
          "oai-authenticated-user-email": "alice@example.com",
          "x-workspace-id": "workspace_attacker",
        },
        body: JSON.stringify({ workspaceId: "workspace_attacker" }),
      },
    ),
    providerEnvironment,
  );

  assert.deepEqual(forged, expected);
});

for (const email of [
  "",
  "alice",
  "alice@@example.com",
  ".alice@example.com",
  "alice..ng@example.com",
  "alice@example",
  "alice@-example.com",
  "alice@example..com",
  "alice @example.com",
  "alice@exa_mple.com",
  `alice@${"a".repeat(64)}.com`,
  `${"a".repeat(65)}@example.com`,
  `${"a".repeat(245)}@example.com`,
]) {
  test(`OpenAI Sites rejects malformed email ${JSON.stringify(email)}`, async () => {
    const principal = await resolveTrustedSession(
      sitesRequest({ "oai-authenticated-user-email": email }),
      providerEnvironment,
    );

    assert.equal(principal, null);
  });
}

test("optional Sites name metadata never changes identity and fails closed when malformed", async () => {
  const emailOnly = await resolveTrustedSession(
    sitesRequest({
      "oai-authenticated-user-email": "alice@example.com",
      "oai-authenticated-user-full-name": "Alice%20Ng",
    }),
    providerEnvironment,
  );
  const malformedName = await resolveTrustedSession(
    sitesRequest({
      "oai-authenticated-user-email": "alice@example.com",
      "oai-authenticated-user-full-name": "%E0%A4%A",
      "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
    }),
    providerEnvironment,
  );

  assert.equal(emailOnly?.fullName, null);
  assert.equal(malformedName?.fullName, null);
  assert.equal(emailOnly?.userId, malformedName?.userId);
});

function sitesRequest(headers: Record<string, string>): Request {
  return new Request("https://vsee.test/api/deals", { headers });
}
