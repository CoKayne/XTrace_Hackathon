import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  createMemoryUnderwritingArtifactsRepository,
} from "../../db/repositories/underwriting-artifacts";
import {
  createMemoryUnderwritingRunsRepository,
  type CandidateFinalization,
} from "../../db/repositories/underwriting-runs";
import { ScenarioInputFieldSchema } from "../../lib/contracts/underwriting";

const migrationPath = fileURLToPath(
  new URL("../../drizzle/0011_underwriting_runs.sql", import.meta.url),
);
const migrations = [
  "0000_vsee_postgres.sql",
  "0001_remove_report_delivery.sql",
  "0002_durable_decision_lineage.sql",
  "0003_sanitize_report_next_steps.sql",
  "0004_company_analyses.sql",
  "0005_sample_decision_label.sql",
  "0006_reasoner_judgments.sql",
  "0007_uploaded_documents.sql",
  "0008_workspace_composite_identity.sql",
  "0009_source_revision_deal_registry.sql",
  "0010_underwriting_references.sql",
  "0011_underwriting_runs.sql",
].map((filename) =>
  fileURLToPath(new URL(`../../drizzle/${filename}`, import.meta.url))
);
const postgresAvailable = spawnSync(
  "psql",
  [
    "-d",
    "postgres",
    "-Atqc",
    "select (rolsuper or rolcreatedb)::text from pg_roles where rolname = current_user",
  ],
  { encoding: "utf8" },
);
const canCreateTemporaryDatabase =
  postgresAvailable.status === 0
  && postgresAvailable.stdout.trim() === "true"
  && spawnSync("createdb", ["--version"]).status === 0
  && spawnSync("dropdb", ["--version"]).status === 0;
const requirePostgres = process.env.REQUIRE_POSTGRES_MIGRATION_TESTS === "1";

function deterministicOptions() {
  let sequence = 0;
  return {
    now: () => new Date("2026-07-29T12:00:00.000Z"),
    idGenerator: (kind: "batch" | "candidate") =>
      `${kind}_${++sequence}`,
    leaseTokenGenerator: () => `lease_${++sequence}`,
  };
}

async function twoClaimedCandidates() {
  const artifacts = createMemoryUnderwritingArtifactsRepository();
  const runs = createMemoryUnderwritingRunsRepository({
    ...deterministicOptions(),
    artifacts,
  });
  const batch = await runs.createOrReuseBatch({
    workspaceId: "workspace_1",
    scanRunId: "scan_1",
    batchInputFingerprint: `sha256:${"1".repeat(64)}`,
    fundPolicySnapshotId: "fund_policy_1",
    forceRefresh: false,
    refreshNonce: null,
    rerunOfId: null,
  });
  await runs.saveSelections({
    batchId: batch.id,
    selections: [
      {
        dealId: "deal_1",
        status: "selected",
        rank: 1,
        reason: "First",
      },
      {
        dealId: "deal_2",
        status: "selected",
        rank: 2,
        reason: "Second",
      },
    ],
  });
  await runs.createSelectedCandidates({
    batchId: batch.id,
    dealIds: ["deal_1", "deal_2"],
  });
  const first = await runs.claimNextCandidate({
    workerId: "worker_1",
    leaseSeconds: 60,
  });
  assert.ok(first);
  return { artifacts, runs, batch, first };
}

function finalization(input: {
  candidateRunId: string;
  dealId: string;
  workerId: string;
  leaseToken: string;
}): CandidateFinalization {
  const scenarioInputs = (scenario: "bear" | "base" | "bull") =>
    ScenarioInputFieldSchema.options.map((field) => ({
      id: `${scenario}_${field}`,
      scenario,
      field,
      value: null,
      unit: null,
      evidenceItemId: null,
      assumptionItemId: null,
      unavailableReason: `${field} is not available.`,
    }));
  return {
    workerId: input.workerId,
    leaseToken: input.leaseToken,
    candidateRunId: input.candidateRunId,
    candidateAnalysisFingerprint: `sha256:${"a".repeat(64)}`,
    evidencePack: {
      id: `evidence_pack_${input.dealId}`,
      version: 1,
      workspaceId: "workspace_1",
      dealId: input.dealId,
      asOfDate: "2026-07-29",
      sourceRevisionIds: ["revision_1"],
      facts: [],
      assumptions: [],
      conflicts: [],
      coverage: {
        minimumModelInputsComplete: false,
        criticalEvidenceComplete: false,
        missingFieldIds: ["arr"],
        blockingConflictIds: [],
        decisionCeiling: "Advance",
        underwritingStatus: "available",
        reasonCodes: ["ARR_NOT_REPORTED"],
      },
      createdAt: "2026-07-29T12:00:00.000Z",
    },
    context: {
      id: "context_1",
      contextVersion: "1",
      stage: "seed",
      businessModel: "b2b_saas",
      geography: "us",
      securityType: "preferred",
      asOfDate: "2026-07-29",
      criticalEvidenceProfileId: "critical_1",
      benchmarkPackId: "benchmark_1",
      benchmarkCompatibility: "exact",
      valuationMethodPolicyId: "valuation_policy_1",
      decisionPolicyId: "decision_policy_1",
      frameworkPackId: "framework_pack_1",
    },
    scenarioModel: {
      id: `scenario_model_${input.dealId}`,
      candidateRunId: input.candidateRunId,
      formulaPolicyVersion: "valuation_policy_1",
      scenarios: (["bear", "base", "bull"] as const).map((name) => ({
        name,
        inputs: scenarioInputs(name),
      })),
      probabilityWeighted: false,
    },
    calculations: [],
    judgments: [],
    disagreements: [],
    valuation: {
      id: `valuation_${input.dealId}`,
      status: "unavailable",
      scenarios: (["bear", "base", "bull"] as const).map((name) => ({
        name,
        valuation: null,
        calculationIds: [],
      })),
      currentAsk: null,
      maximumAcceptablePreMoney: null,
      initialOwnership: null,
      postDilutionOwnership: null,
      grossMoic: null,
      grossIrr: null,
      pricingPremium: null,
      calculationIds: [],
      blockerCodes: ["ARR_NOT_REPORTED"],
    },
    decision: {
      id: `decision_${input.dealId}`,
      analysisType: "final_synthesis",
      companyQuality: "unavailable",
      priceAttractiveness: "unavailable",
      fundFit: "mixed",
      decision: "Advance",
      decisionCeiling: "Advance",
      hardVeto: false,
      firedRules: [],
      blockingEvidenceItemIds: [],
      claimEdges: [],
      confidence: "low",
    },
    narrative: "The company needs more evidence before an investment decision.",
    actionDrafts: [{
      id: `draft_${input.dealId}`,
      workspaceId: "workspace_1",
      candidateRunId: input.candidateRunId,
      channel: "dd_request",
      audienceType: "founder",
      body: "Please provide current ARR and retention.",
      createdAt: "2026-07-29T12:00:00.000Z",
      updatedAt: "2026-07-29T12:00:00.000Z",
    }],
    versionSnapshot: {
      fundPolicyId: "fund_policy_1",
      benchmarkPackId: "benchmark_1",
      frameworkPackId: "framework_pack_1",
      routerVersion: "router-v1",
      criticalEvidenceProfileId: "critical_1",
      valuationMethodPolicyId: "valuation_policy_1",
      decisionPolicyId: "decision_policy_1",
      formulaVersions: [],
      providerModel: "claude-sonnet-4-5",
      promptVersion: "underwriting-prompt-v1",
      schemaVersion: "underwriting-schema-v1",
      settingsFingerprint: `sha256:${"b".repeat(64)}`,
      applicationCommit: "0002f6b",
    },
  };
}

test("failed finalization leaves no partial artifacts and retains the active lease", async () => {
  const { artifacts, runs, first } = await twoClaimedCandidates();
  const invalid = finalization({
    candidateRunId: first.candidate.id,
    dealId: first.candidate.dealId,
    workerId: "worker_1",
    leaseToken: first.leaseToken,
  });
  invalid.actionDrafts[0].workspaceId = "workspace_foreign";

  await assert.rejects(runs.finalizeCandidate(invalid), /workspace|artifact/i);
  assert.deepEqual(artifacts.inspect().rowCounts, {
    evidencePacks: 0,
    contexts: 0,
    scenarioModels: 0,
    calculations: 0,
    judgments: 0,
    disagreements: 0,
    valuations: 0,
    decisions: 0,
    narratives: 0,
    actionDrafts: 0,
    claimEdges: 0,
    versionSnapshots: 0,
  });
  assert.equal(
    runs.inspect().candidates.find(({ id }) => id === first.candidate.id)
      ?.status,
    "running",
  );
});

test("finalization rejects claim edges whose typed dependency is not persisted", async () => {
  const { artifacts, runs, first } = await twoClaimedCandidates();
  const invalid = finalization({
    candidateRunId: first.candidate.id,
    dealId: first.candidate.dealId,
    workerId: "worker_1",
    leaseToken: first.leaseToken,
  });
  invalid.decision.claimEdges.push({
    claimItemId: invalid.decision.id,
    dependencyItemId: "foreign_fact",
    dependencyType: "fact",
  });

  await assert.rejects(
    runs.finalizeCandidate(invalid),
    /claim|dependency|resolve/i,
  );
  assert.equal(artifacts.inspect().rowCounts.claimEdges, 0);
  assert.equal(
    runs.inspect().candidates.find(({ id }) => id === first.candidate.id)
      ?.status,
    "running",
  );
});

test("one completed candidate and one failed candidate leave the batch partial", async () => {
  const { artifacts, runs, batch, first } = await twoClaimedCandidates();
  const completed = await runs.finalizeCandidate(finalization({
    candidateRunId: first.candidate.id,
    dealId: first.candidate.dealId,
    workerId: "worker_1",
    leaseToken: first.leaseToken,
  }));
  const second = await runs.claimNextCandidate({
    workerId: "worker_2",
    leaseSeconds: 60,
  });
  assert.ok(second);
  await runs.markCandidateFailed({
    candidateRunId: second.candidate.id,
    publicReason: "The provider returned an unusable response.",
  });

  assert.equal(completed.status, "completed");
  let llmCalls = 0;
  let formulaCalls = 0;
  const reusable = await artifacts.findReusable({
    workspaceId: "workspace_1",
    candidateAnalysisFingerprint: completed.candidateAnalysisFingerprint,
  });
  if (!reusable) {
    llmCalls += 1;
    formulaCalls += 1;
  }
  assert.equal(reusable?.candidateRunId, completed.id);
  assert.deepEqual({ llmCalls, formulaCalls }, { llmCalls: 0, formulaCalls: 0 });
  assert.equal(
    await artifacts.findReusable({
      workspaceId: "workspace_foreign",
      candidateAnalysisFingerprint: completed.candidateAnalysisFingerprint,
    }),
    null,
  );
  assert.equal(
    runs.inspect().batches.find(({ id }) => id === batch.id)?.status,
    "partial",
  );
  assert.equal(artifacts.inspect().rowCounts.evidencePacks, 1);
  assert.equal(artifacts.inspect().rowCounts.actionDrafts, 1);
});

test("finalization rejects a foreign lease and stores exact immutable snapshots once", async () => {
  const { artifacts, runs, first } = await twoClaimedCandidates();
  const payload = finalization({
    candidateRunId: first.candidate.id,
    dealId: first.candidate.dealId,
    workerId: "worker_1",
    leaseToken: first.leaseToken,
  });
  await assert.rejects(
    runs.finalizeCandidate({ ...payload, leaseToken: "foreign" }),
    /lease/i,
  );
  await runs.finalizeCandidate(payload);
  const stored = await artifacts.getByCandidateRunId({
    workspaceId: "workspace_1",
    candidateRunId: first.candidate.id,
  });

  assert.ok(stored);
  assert.deepEqual(stored.evidencePack, payload.evidencePack);
  assert.deepEqual(stored.context, payload.context);
  assert.deepEqual(stored.scenarioModel, payload.scenarioModel);
  assert.deepEqual(stored.valuation, payload.valuation);
  assert.deepEqual(stored.decision, payload.decision);
  assert.deepEqual(stored.versionSnapshot, payload.versionSnapshot);
  await assert.rejects(runs.finalizeCandidate(payload), /completed|lease/i);
  assert.equal(artifacts.inspect().rowCounts.evidencePacks, 1);
});

test("0011 declares an atomic finalization RPC without calling legacy report persistence", () => {
  const migration = readFileSync(migrationPath, "utf8");
  assert.match(
    migration,
    /create or replace function public\.finalize_candidate_underwriting\(jsonb\)/i,
  );
  assert.match(migration, /underwriting_batches/i);
  assert.match(migration, /candidate_runs/i);
  assert.match(migration, /candidate_version_snapshots/i);
  assert.match(migration, /underwriting_claim_edges/i);
  assert.doesNotMatch(migration, /save_intelligence_report/i);
});

test(
  "0011 rolls back every artifact row when finalization fails after inserts begin",
  { skip: !canCreateTemporaryDatabase && !requirePostgres },
  () => {
    assert.equal(
      canCreateTemporaryDatabase,
      true,
      "PostgreSQL with temporary-database privileges is required.",
    );
    withTemporaryDatabase((database) => {
      executeSql(database, `
        do $$
        begin
          create role service_role nologin noinherit bypassrls;
        exception when duplicate_object then null;
        end;
        $$;
      `);
      for (const migration of migrations) applySql(database, migration);
      executeSql(database, `
        insert into public.workspaces (id, name)
        values ('workspace_1', 'Workspace 1');
        insert into public.scan_runs (
          id, workspace_id, mode, status
        ) values (
          '00000000-0000-4000-8000-000000000801',
          'workspace_1',
          'structured',
          'completed'
        );
        select public.activate_fund_policy_version(jsonb_build_object(
          'workspaceId', 'workspace_1',
          'actorId', null,
          'expectedActiveVersionId', null,
          'action', 'recommended'
        ));
        insert into public.companies (workspace_id, id, name)
        values ('workspace_1', 'company_1', 'Company 1');
        insert into public.deals (
          workspace_id, id, company_id, company_name, status
        ) values (
          'workspace_1', 'deal_1', 'company_1', 'Company 1', 'screening'
        );
        insert into public.underwriting_batches (
          id, workspace_id, scan_run_id, status,
          batch_input_fingerprint, fund_policy_snapshot_id,
          force_refresh, refresh_nonce, rerun_of_id
        ) values (
          'batch_1',
          'workspace_1',
          '00000000-0000-4000-8000-000000000801',
          'running',
          'sha256:${"1".repeat(64)}',
          'fund_policy:workspace_1:v1',
          false,
          null,
          null
        );
        insert into public.candidate_runs (
          id, batch_id, workspace_id, deal_id, status,
          candidate_analysis_fingerprint, worker_id, lease_token,
          lease_expires_at
        ) values (
          'candidate_db',
          'batch_1',
          'workspace_1',
          'deal_1',
          'running',
          'pending:candidate_db',
          'worker_db',
          'lease_db',
          now() + interval '5 minutes'
        );
      `);
      const payload = finalization({
        candidateRunId: "candidate_db",
        dealId: "deal_1",
        workerId: "worker_db",
        leaseToken: "lease_db",
      });
      payload.actionDrafts.push({ ...payload.actionDrafts[0] });
      assert.throws(() =>
        executeSql(database, `
          set role service_role;
          select public.finalize_candidate_underwriting(
            ${sqlJson(payload)}
          );
        `)
      );

      assert.equal(
        executeSql(database, `
          select
            (select count(*) from public.evidence_packs)
            || '|' ||
            (select count(*) from public.candidate_context_snapshots)
            || '|' ||
            (select count(*) from public.scenario_models)
            || '|' ||
            (select count(*) from public.valuation_evaluations)
            || '|' ||
            (select count(*) from public.final_syntheses)
            || '|' ||
            (select count(*) from public.action_drafts)
            || '|' ||
            (select count(*) from public.candidate_version_snapshots)
            || '|' ||
            (select status from public.candidate_runs
              where id = 'candidate_db');
        `),
        "0|0|0|0|0|0|0|running",
      );

      payload.actionDrafts.pop();
      payload.decision.claimEdges.push({
        claimItemId: payload.decision.id,
        dependencyItemId: "foreign_fact",
        dependencyType: "fact",
      });
      assert.throws(() =>
        executeSql(database, `
          set role service_role;
          select public.finalize_candidate_underwriting(${sqlJson(payload)});
        `)
      );
      assert.equal(
        executeSql(database, `
          select
            (select count(*) from public.evidence_packs)
            || '|' ||
            (select count(*) from public.underwriting_claim_edges)
            || '|' ||
            (select status from public.candidate_runs
              where id = 'candidate_db');
        `),
        "0|0|running",
      );
      payload.decision.claimEdges.pop();
      executeSql(database, `
        set role service_role;
        select public.finalize_candidate_underwriting(${sqlJson(payload)});
      `);
      assert.equal(
        executeSql(database, `
          select status || '|' || candidate_analysis_fingerprint
          from public.candidate_runs
          where id = 'candidate_db';
        `),
        `completed|sha256:${"a".repeat(64)}`,
      );
      assert.equal(
        executeSql(database, `
          select
            (select count(*) from public.evidence_packs)
            || '|' ||
            (select count(*) from public.action_drafts)
            || '|' ||
            (select count(*) from public.candidate_version_snapshots);
        `),
        "1|1|1",
      );
    });
  },
);

function withTemporaryDatabase(run: (database: string) => void): void {
  const database =
    `vsee_underwriting_runs_${process.pid}_${
      randomUUID().replaceAll("-", "")
    }`;
  execFileSync("createdb", [database], { stdio: "pipe" });
  try {
    run(database);
  } finally {
    execFileSync("dropdb", ["--if-exists", database], { stdio: "pipe" });
  }
}

function applySql(database: string, path: string): void {
  execFileSync(
    "psql",
    ["-v", "ON_ERROR_STOP=1", "-d", database, "-f", path],
    { stdio: "pipe" },
  );
}

function executeSql(database: string, sql: string): string {
  return execFileSync(
    "psql",
    ["-v", "ON_ERROR_STOP=1", "-d", database, "-AtF", "|", "-c", sql],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
}

function sqlJson(value: unknown): string {
  return `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
}
