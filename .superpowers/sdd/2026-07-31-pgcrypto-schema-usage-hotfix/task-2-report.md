# Task 2 Report: Guarded Release Chain Through 0018

## Scope

Extended both guarded production launchers and the reviewed catalog stage
mapping through `0018_pgcrypto_registry_schema_usage.sql`. The `0018` mapping
reuses the accepted `0017` fingerprint sets; no catalog checksum was added.

The `0018` sentinel dynamically locates pgcrypto's `digest(bytea, text)` schema
and verifies `vsee_registry_owner` has `USAGE`. It also requires the `0017`
sentinel, preventing an already-usable `public` schema from being interpreted
as a later migration before `0017` exists.

Updated the release fixtures, PostgreSQL 17.6 production-gate test names and
assertions, physical migration documentation, maintenance verification, and
rollback wording. Documentation states that `0018` repairs only the internal
pgcrypto schema dependency used by canonical fingerprints.

## TDD evidence

1. Updated release expectations for `0018` before launcher/catalog changes.
2. Ran the prescribed focused release suite and recorded RED: it failed because
   launchers, catalog mapping, and operator documentation still ended at
   `0017`.
3. Implemented the minimal guarded-chain extension and reran the focused suite:
   PASS.

## Verification

- Focused release suite: PASS.
- `0018` focused integration test on isolated PostgreSQL 17.6: 2 passed, 0
  failed.
- `npm run test:migrations:production-pg176` on isolated `postgres:17.6`:
  3 passed, 0 failed, 0 skipped.
- Shell syntax: `zsh -n` passed for both guarded launchers.
- Diff whitespace check: passed.

## Full migration-suite note

`npm run test:migrations` was also run on the isolated PostgreSQL 17.6
container but ended with 47 failures after an earlier disposable
`vsee_reset_*` database retained cluster-global owner-role dependencies. The
first failure was `drop role ... vsee_registry_owner` because objects in that
other disposable database depended on the role; later failures are the
resulting owner-role attestation failures. This is cross-file global-role test
fixture coupling, not an `0018` assertion or migration failure. The required
focused release suite and clean production-profile gate both pass.
