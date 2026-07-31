# VSee public-sandbox operations runbook

The production Sites URL is a **public, no-login test sandbox** running
`VSEE_DEPLOYMENT_MODE=public_sandbox`. Do not upload confidential, personal,
customer, or production-sensitive data. Anyone with the URL can use the
sandbox workspace. `public_demo` remains the anonymous, synthetic, read-only
fallback mode; `product` remains a separately authenticated environment.

## Before the cutover

Use the exact reviewed commit for both the Sites build and the Worker. Keep the
Sites Web process and long-running Worker separate, but pointed at the same
Supabase workspace. Store credentials only in the deployer's macOS Keychain;
never paste a value into the shell, a runbook, chat, or a `.env` file.

To add or update the database connection, run this locally and enter the value
only at the Keychain prompt:

```bash
security add-generic-password -U -a "$USER" -s "vsee-supabase-db-url" -w
```

The Worker launcher obtains its other required values from Keychain services:
`vsee-supabase-url`, `vsee-supabase-service-role-key`,
`vsee-anthropic-api-key`, `vsee-xtrace-api-key`, and
`vsee-document-url-signing-secret`. `mmk_` XTrace keys do not require an
XTrace organization ID.

## Database migration

The production project may still have the early upload-extraction prototype
instead of the final `0007` table contract. From the checked-out reviewed
commit, first run the guarded baseline bootstrap:

```bash
./scripts/bootstrap-production-baseline.zsh
```

The bootstrap never prints the database URL. Before changing anything it
classifies the complete pre-`0008` boundary, `0008`, `0009`, and all later
migration sentinels. It accepts only:

- a complete current `0007` boundary; or
- the exact known prototype `uploaded_documents` shape when no row has an
  active extraction lease/state and no row contains legacy extracted facts,
  memory IDs/text, company identity, Deal identity, or XTrace job identity.

For that one safe prototype shape it adds the current extraction-preview
contract while retaining every legacy column and row, then applies and verifies
`0008` and `0009`. It refuses unknown, partial, unsafe, or gapped states. Do
not bypass that refusal or apply the compatibility SQL manually.

After the bootstrap reports that `0009` is complete, apply the forward chain:

```bash
./scripts/apply-production-migrations.zsh
```

The forward launcher also never prints the database URL. It requires the
complete `0009` boundary, inventories the `0010`–`0017` sentinels before
changing anything, refuses any gap, applies only from the first missing
migration in order, and re-verifies every sentinel. Resolve a failed sentinel
or gap before retrying; do not skip a file or run a later migration manually.

## Start the Worker

Start one foreground Worker from the same reviewed commit:

```bash
./scripts/run-worker-from-keychain.zsh
```

It uses `public_sandbox`, the `workspace_demo` workspace, the production
XTrace API endpoint, and the configured public market feeds. It writes its
combined output only to `.runtime/worker.log`, which is ignored by Git. Stop
the foreground process before starting another Worker so workers do not contend
for the same queue.

## Health gate before Scan

Open the public Sites URL and confirm its health display shows all required
integrations ready: PostgreSQL, the Worker heartbeat, Anthropic, and XTrace
when the XTrace toggle is on. The **WAKE AGENT & SCAN MARKET** action must stay
disabled until that health gate passes. If the Worker is not healthy, inspect
`.runtime/worker.log`, correct the Keychain/configuration issue, restart the
single Worker, and wait for its heartbeat instead of bypassing the check.

## Public-sandbox test flow

1. Upload a non-confidential PDF or DOCX source.
2. Wait for Worker extraction, review the extracted evidence, and confirm the
   source-to-Deal assignment.
3. Enable XTrace when memory-backed recall is part of the test.
4. Run **WAKE AGENT & SCAN MARKET** after the health gate is green.
5. Review the generated report and its traceable evidence rather than treating
   the sandbox result as a customer investment decision.

The report includes the market-scan result and company analyses; opening a
candidate exposes these named underwriting sections: **What happened?**,
**Changed assumptions**, **Which historical companies are affected?**, and
**Company underwriting**. The Company underwriting section identifies CORE
FRAMEWORK versus NAMED ADVISORY judgments, the advisory pack/version,
component cards, exact source lineage, supporting/counterevidence Evidence Pack
IDs, limitations, and independent disagreements. Named advisory viewpoints have
formal decision weight zero.

## Reset test view

**RESET TEST VIEW** advances the sandbox generation marker. It clears the
current test view's scan-derived reports, analyses, runs, and observed market
events without deleting durable source material, confirmed uploads, XTrace
memory, or framework definitions. A browser refresh does not reset anything;
queued or running work is not a substitute for a clean reset, so wait for a
quiet Worker before starting a new test flow.

## Rollback

If the public-sandbox cutover fails, stop the Worker, restore the previously
saved Sites version, and change the Sites runtime mode back to
`VSEE_DEPLOYMENT_MODE=public_demo`. Verify the restored public site is the
anonymous synthetic read-only demo. **Do not roll back database migrations:**
the `0010`–`0017` forward migrations remain applied during a Sites rollback.
