# Market Scan Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the eight-source market scan reliable and persist actionable run failure messages.

**Architecture:** Source defaults and provider boundaries remain in `lib/market`; the Worker continues to own scans. Failed stage messages are persisted through the existing run warning channel, so PostgreSQL and the Runs UI require no schema expansion.

**Tech Stack:** TypeScript, Node test runner, vinext, Supabase PostgreSQL, local long-running Worker, XTrace, Anthropic Opus 4.8, Sites.

## Global Constraints

- Keep the scan window exactly 14 days.
- Keep all provider pagination finite.
- Keep all public evidence source-backed.
- Keep browser code free of Anthropic, XTrace, and Supabase service credentials.
- Do not delete or rewrite historical runs.

---

### Task 1: Repair and align market providers

**Files:**
- Modify: `tests/integration/market-providers.test.ts`
- Modify: `tests/unit/market-config.test.ts`
- Modify: `lib/market/providers.ts`
- Modify: `lib/market/config.ts`

**Interfaces:**
- Consumes: `readMarketProviderConfiguration(environment?)`
- Produces: eight default providers when feed overrides are absent; current FTC RSS URL; a 20-page Federal Register bound

- [ ] **Step 1: Write failing provider tests**

Add assertions that the FTC provider requests
`https://www.ftc.gov/feeds/press-release.xml`, and that a Federal Register
response requiring 11 pages completes instead of raising the old 10-page
limit error.

- [ ] **Step 2: Verify the provider tests fail**

Run:

```bash
node --import tsx --test tests/integration/market-providers.test.ts
```

Expected: the FTC URL assertion and 11-page completion test fail.

- [ ] **Step 3: Write a failing configuration test**

Add a test that calls `readMarketProviderConfiguration({})` and expects:

```ts
assert.equal(configuration.configuredProviderCount, 8);
assert.deepEqual(
  configuration.options.officialAnnouncementFeeds?.map((feed) => feed.id),
  ["sequoia-official", "lightspeed-official"],
);
assert.deepEqual(
  configuration.options.stablePublisherFeeds?.map((feed) => feed.id),
  ["a16z-news"],
);
```

Also assert that explicit `[]` values disable the defaults.

- [ ] **Step 4: Verify the configuration test fails**

Run:

```bash
node --import tsx --test tests/unit/market-config.test.ts
```

Expected: the default count is five rather than eight.

- [ ] **Step 5: Implement the minimal provider changes**

In `lib/market/providers.ts`, set:

```ts
export const MAX_PROVIDER_PAGES = 20;
export const FTC_PRESS_RELEASES_RSS_URL =
  "https://www.ftc.gov/feeds/press-release.xml";
```

In `lib/market/config.ts`, use fixed default arrays only when an environment
value is absent. Preserve explicit arrays as overrides.

- [ ] **Step 6: Verify Task 1**

Run:

```bash
node --import tsx --test tests/integration/market-providers.test.ts tests/unit/market-config.test.ts
```

Expected: all selected tests pass.

- [ ] **Step 7: Commit Task 1**

```bash
git add lib/market/config.ts lib/market/providers.ts tests/integration/market-providers.test.ts tests/unit/market-config.test.ts
git commit -m "fix: align market provider defaults"
```

### Task 2: Persist exact stage failures

**Files:**
- Modify: `tests/integration/process-run.test.ts`
- Modify: `worker/process-run.ts`

**Interfaces:**
- Consumes: `RunsRepository.updateStage`
- Produces: failed runs whose `warnings` include `<stage> failed: <message>`

- [ ] **Step 1: Write the failing run test**

Create a claimed run whose market service throws:

```ts
throw new Error("FTC feed returned HTML");
```

Assert:

```ts
assert.equal(failed?.status, "failed");
assert.equal(failed?.currentStage, "market_scan");
assert.deepEqual(
  failed?.warnings,
  ["market_scan failed: FTC feed returned HTML"],
);
```

- [ ] **Step 2: Verify the run test fails**

Run:

```bash
node --import tsx --test tests/integration/process-run.test.ts
```

Expected: the run is failed but its warnings are empty.

- [ ] **Step 3: Implement active-stage failure recording**

Track the most recent stage and whether it already persisted `failed`. In the
outer catch, record a failed stage with the bounded error message only when
the stage has not already done so, then finish the run as failed and rethrow.

- [ ] **Step 4: Verify Task 2**

Run:

```bash
node --import tsx --test tests/integration/process-run.test.ts
```

Expected: all selected tests pass without duplicate import-gate warnings.

- [ ] **Step 5: Commit Task 2**

```bash
git add worker/process-run.ts tests/integration/process-run.test.ts
git commit -m "fix: persist scan stage failures"
```

### Task 3: End-to-end verification and deployment

**Files:**
- Modify only if verification exposes a regression.

**Interfaces:**
- Consumes: Keychain credentials, Supabase corpus, local Worker, Sites project
- Produces: a deployed production version and a completed real scan

- [ ] **Step 1: Run the full verification suite**

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

Expected: zero failures.

- [ ] **Step 2: Probe all providers**

Run the real provider service without persistence and verify it reports eight
providers, with FTC and Federal Register successful.

- [ ] **Step 3: Restart the local Worker**

Load Supabase, XTrace, and Anthropic credentials from macOS Keychain and start
`npm run worker` using Apple Silicon Node.

- [ ] **Step 4: Run one real XTrace scan**

Queue `{ "xtraceEnabled": true }`, poll the durable run to a terminal state,
and confirm a report is present in `/api/reports`.

- [ ] **Step 5: Push and publish**

Push `main`, save the exact validated Sites version, publish it with the
existing public access mode, and poll to `succeeded`.

- [ ] **Step 6: Verify production**

Confirm the production root and `/api/settings/health` both return HTTP 200 and
that `marketProviders` equals eight.

