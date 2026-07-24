# Market Scan Reliability Design

## Goal

Make demo scans finish without avoidable provider failures, make the Web health
view and the local Worker use the same eight public sources, and preserve the
exact failure message when a run genuinely fails.

## Confirmed root causes

1. The FTC press-release URL now returns HTML. FTC's current official RSS URL is
   `https://www.ftc.gov/feeds/press-release.xml`.
2. Federal Register published 1,114 documents in the tested 14-day window. The
   current 10-page × 100-item bound rejects that response after page 10.
3. Sites has three configured VC feeds, but the local Worker was started without
   those environment variables. The Web health route therefore reported eight
   providers while the Worker scanned only five.
4. Run rows persist warnings and the current stage, but an unhandled stage error
   is not added to warnings before the run is marked failed. The UI therefore
   shows the failure stage without the underlying message.

## Design

### Public-source configuration

- Replace the obsolete FTC URL with the current official RSS URL.
- Raise the bounded provider page ceiling from 10 to 20. This remains finite
  while covering the observed 1,114 Federal Register documents.
- Treat a16z News, Sequoia Capital, and Lightspeed as the default public VC
  feeds when the corresponding environment variables are absent.
- An explicitly supplied JSON array, including `[]`, remains an override. This
  preserves deployer control and avoids duplicate providers on Sites.

The default provider count becomes eight:

1. Federal Register
2. FDA
3. SEC
4. FTC
5. TechCrunch Venture
6. Sequoia Capital
7. Lightspeed
8. a16z News

### Failure persistence

`processClaimedRun` will track the currently active stage. If a stage throws
before it recorded its own failed state, the outer error handler will:

1. record that stage as failed;
2. append a bounded, human-readable failure message to the run warnings;
3. mark the run failed; and
4. rethrow so the Worker log still records the error.

Stages that already persisted a failure will not duplicate the warning.
Existing historical rows are not modified or deleted.

The existing Runs UI already renders durable warnings, so no new database
column or browser-only state is required.

### Worker and deployment

The local Worker will be restarted after the code change. Because default
feeds live in shared configuration, both the Sites health route and a Worker
started without optional feed variables resolve to the same eight providers.

The verification scan must demonstrate:

- all eight configured providers are loaded;
- the FTC response is parsed as RSS;
- Federal Register completes within the 20-page bound;
- a real scan reaches report generation;
- any remaining provider problem names the failed provider and reason; and
- production health remains HTTP 200 after deployment.

## Safety constraints

- Do not delete historical failed runs.
- Do not weaken the evidence filter or the medium-confidence opportunity
  threshold.
- Do not silently return a truncated Federal Register response.
- Do not expose API keys or service-role credentials to the browser.
- Keep the Worker as the only component performing long-running scans.

