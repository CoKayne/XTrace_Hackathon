import {
  bigint,
  doublePrecision,
  foreignKey,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import type {
  CompanyBrief,
  CompanyMarketEvidence,
  EvidenceCoverage,
  InvestmentMemorySnapshot,
  OpportunityReportItem,
  SourceRef,
} from "../lib/contracts/domain";
import type { ExtractionPreview } from "./repositories/uploaded-documents";

export const workspaces = pgTable("workspaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const scanRuns = pgTable("scan_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: text("workspace_id").notNull().references(
    () => workspaces.id,
  ),
  mode: text("mode").notNull(),
  windowDays: integer("window_days").notNull().default(14),
  status: text("status").notNull().default("queued"),
  currentStage: text("current_stage"),
  warningCount: integer("warning_count").notNull().default(0),
  warnings: jsonb("warnings").$type<string[]>().notNull().default([]),
  workerId: text("worker_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
}, (table) => [
  unique("scan_runs_workspace_id_id_unique").on(table.workspaceId, table.id),
]);

export const scanRunSteps = pgTable("scan_run_steps", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  runId: uuid("run_id").notNull(),
  stage: text("stage").notNull(),
  status: text("status").notNull(),
  warning: text("warning"),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => [
  foreignKey({
    columns: [table.workspaceId, table.runId],
    foreignColumns: [scanRuns.workspaceId, scanRuns.id],
    name: "scan_run_steps_workspace_run_fkey",
  }).onDelete("cascade"),
]);

export const workerHeartbeats = pgTable("worker_heartbeats", {
  workerId: text("worker_id").primaryKey(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
});

export const publicRequestLimits = pgTable("public_request_limits", {
  scope: text("scope").notNull(),
  clientHash: text("client_hash").notNull(),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  requestCount: integer("request_count").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.scope, table.clientHash] }),
]);

export const sourceDocuments = pgTable("source_documents", {
  id: text("id").primaryKey(),
  filename: text("filename").notNull(),
  title: text("title").notNull(),
  role: text("role").notNull(),
  companyName: text("company_name"),
  dealId: text("deal_id"),
  checksum: text("checksum").notNull().unique(),
  byteSize: integer("byte_size").notNull(),
  objectKey: text("object_key").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const workspaceDocuments = pgTable("workspace_documents", {
  workspaceId: text("workspace_id").notNull().references(
    () => workspaces.id,
    { onDelete: "cascade" },
  ),
  documentId: text("document_id").notNull().references(
    () => sourceDocuments.id,
    { onDelete: "cascade" },
  ),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.workspaceId, table.documentId] }),
]);

export const companies = pgTable("companies", {
  id: text("id").notNull(),
  workspaceId: text("workspace_id").notNull().references(
    () => workspaces.id,
    { onDelete: "cascade" },
  ),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.workspaceId, table.id] }),
]);

export const deals = pgTable("deals", {
  id: text("id").notNull(),
  workspaceId: text("workspace_id").notNull().references(
    () => workspaces.id,
    { onDelete: "cascade" },
  ),
  companyId: text("company_id").notNull(),
  companyName: text("company_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.workspaceId, table.id] }),
  foreignKey({
    columns: [table.workspaceId, table.companyId],
    foreignColumns: [companies.workspaceId, companies.id],
    name: "deals_workspace_company_fkey",
  }).onDelete("cascade"),
]);

export const sourceEvidence = pgTable("source_evidence", {
  id: text("id").notNull(),
  workspaceId: text("workspace_id").notNull().references(
    () => workspaces.id,
    { onDelete: "cascade" },
  ),
  documentId: text("document_id").notNull().references(
    () => sourceDocuments.id,
    { onDelete: "cascade" },
  ),
  dealId: text("deal_id").notNull(),
  companyName: text("company_name").notNull(),
  provenance: text("provenance").notNull(),
  page: integer("page").notNull(),
  fact: text("fact").notNull(),
  excerpt: text("excerpt").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.workspaceId, table.id] }),
  foreignKey({
    columns: [table.workspaceId, table.dealId],
    foreignColumns: [deals.workspaceId, deals.id],
    name: "source_evidence_workspace_deal_fkey",
  }).onDelete("cascade"),
]);

export const dealInteractions = pgTable("deal_interactions", {
  id: text("id").notNull(),
  workspaceId: text("workspace_id").notNull().references(
    () => workspaces.id,
    { onDelete: "cascade" },
  ),
  documentId: text("document_id").notNull().references(
    () => sourceDocuments.id,
    { onDelete: "cascade" },
  ),
  dealId: text("deal_id").notNull(),
  companyName: text("company_name").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  provenance: text("provenance").notNull(),
  label: text("label").notNull(),
  status: text("status").notNull(),
  decisionReason: text("decision_reason").notNull(),
  concerns: jsonb("concerns").$type<string[]>().notNull().default([]),
  revisitConditions: jsonb("revisit_conditions").$type<string[]>().notNull().default([]),
  meetingSummary: text("meeting_summary").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.workspaceId, table.id] }),
  foreignKey({
    columns: [table.workspaceId, table.dealId],
    foreignColumns: [deals.workspaceId, deals.id],
    name: "deal_interactions_workspace_deal_fkey",
  }).onDelete("cascade"),
]);

export const marketEvents = pgTable("market_events", {
  workspaceId: text("workspace_id").notNull().references(
    () => workspaces.id,
    { onDelete: "cascade" },
  ),
  id: text("id").notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.workspaceId, table.id] }),
]);

export const intelligenceReports = pgTable("intelligence_reports", {
  id: text("id").notNull(),
  workspaceId: text("workspace_id").notNull().references(
    () => workspaces.id,
    { onDelete: "cascade" },
  ),
  runId: uuid("run_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  marketSummary: text("market_summary").notNull(),
  opportunities: jsonb("opportunities")
    .$type<OpportunityReportItem[]>()
    .notNull()
    .default([]),
  analysisStatus: text("analysis_status").notNull().default("completed"),
  companyCount: integer("company_count").notNull().default(0),
  beliefRevisedCount: integer("belief_revised_count").notNull().default(0),
  monitorCount: integer("monitor_count").notNull().default(0),
  noMaterialChangeCount: integer("no_material_change_count").notNull().default(0),
  analysisUnavailableCount: integer("analysis_unavailable_count")
    .notNull()
    .default(0),
  priorityDealId: text("priority_deal_id"),
  evidenceCoverage: jsonb("evidence_coverage")
    .$type<EvidenceCoverage>()
    .notNull()
    .default({
      acceptedPublicEvents: 0,
      excludedPublicItems: 0,
      truncatedPublicEvents: 0,
      recalledDealCount: 0,
      unavailableDealCount: 0,
    }),
}, (table) => [
  primaryKey({ columns: [table.workspaceId, table.id] }),
  unique("intelligence_reports_one_per_run").on(
    table.workspaceId,
    table.runId,
  ),
  foreignKey({
    columns: [table.workspaceId, table.runId],
    foreignColumns: [scanRuns.workspaceId, scanRuns.id],
    name: "intelligence_reports_workspace_run_fkey",
  }).onDelete("cascade"),
]);

export const companyAnalyses = pgTable("company_analyses", {
  id: text("id").notNull(),
  workspaceId: text("workspace_id").notNull().references(
    () => workspaces.id,
    { onDelete: "cascade" },
  ),
  reportId: text("report_id").notNull(),
  runId: uuid("run_id").notNull(),
  dealId: text("deal_id").notNull(),
  companyName: text("company_name").notNull(),
  dealStatus: text("deal_status").notNull(),
  outcome: text("outcome").notNull(),
  confidence: text("confidence").notNull(),
  score: doublePrecision("score").notNull(),
  investmentMemory: jsonb("investment_memory")
    .$type<InvestmentMemorySnapshot>()
    .notNull(),
  marketEvidence: jsonb("market_evidence")
    .$type<CompanyMarketEvidence>()
    .notNull(),
  implications: jsonb("implications")
    .$type<{ positive: string[]; negative: string[] }>()
    .notNull(),
  recommendedNextMove: text("recommended_next_move").notNull(),
  companyBrief: jsonb("company_brief").$type<CompanyBrief>().notNull(),
  sourceRefs: jsonb("source_refs").$type<SourceRef[]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.workspaceId, table.id] }),
  unique("company_analyses_workspace_report_deal_unique").on(
    table.workspaceId,
    table.reportId,
    table.dealId,
  ),
  foreignKey({
    columns: [table.workspaceId, table.reportId],
    foreignColumns: [intelligenceReports.workspaceId, intelligenceReports.id],
    name: "company_analyses_workspace_report_fkey",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.workspaceId, table.runId],
    foreignColumns: [scanRuns.workspaceId, scanRuns.id],
    name: "company_analyses_workspace_run_fkey",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.workspaceId, table.dealId],
    foreignColumns: [deals.workspaceId, deals.id],
    name: "company_analyses_workspace_deal_fkey",
  }).onDelete("cascade"),
]);

export const xtraceIngestJobs = pgTable("xtrace_ingest_jobs", {
  jobId: text("job_id").notNull(),
  workspaceId: text("workspace_id").notNull().references(
    () => workspaces.id,
    { onDelete: "cascade" },
  ),
  dealId: text("deal_id").notNull(),
  sourceIds: jsonb("source_ids").$type<string[]>().notNull().default([]),
  fixtureIds: jsonb("fixture_ids").$type<string[]>().notNull().default([]),
  bundleFingerprint: text("bundle_fingerprint").notNull(),
  serializerVersion: text("serializer_version").notNull(),
  provenance: text("provenance").notNull(),
  status: text("status").notNull(),
  memoryIds: jsonb("memory_ids").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.workspaceId, table.jobId] }),
  foreignKey({
    columns: [table.workspaceId, table.dealId],
    foreignColumns: [deals.workspaceId, deals.id],
    name: "xtrace_ingest_jobs_workspace_deal_fkey",
  }).onDelete("cascade"),
]);

export const xtraceMemoryLinks = pgTable("xtrace_memory_links", {
  memoryId: text("memory_id").notNull(),
  workspaceId: text("workspace_id").notNull().references(
    () => workspaces.id,
    { onDelete: "cascade" },
  ),
  dealId: text("deal_id").notNull(),
  sourceIds: jsonb("source_ids").$type<string[]>().notNull().default([]),
  fixtureIds: jsonb("fixture_ids").$type<string[]>().notNull().default([]),
  provenance: text("provenance").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.workspaceId, table.memoryId] }),
  foreignKey({
    columns: [table.workspaceId, table.dealId],
    foreignColumns: [deals.workspaceId, deals.id],
    name: "xtrace_memory_links_workspace_deal_fkey",
  }).onDelete("cascade"),
]);

export const uploadedDocuments = pgTable("uploaded_documents", {
  id: text("id").notNull(),
  workspaceId: text("workspace_id").notNull().references(
    () => workspaces.id,
    { onDelete: "cascade" },
  ),
  filename: text("filename").notNull(),
  contentType: text("content_type").notNull(),
  byteSize: bigint("byte_size", { mode: "number" }).notNull(),
  checksum: text("checksum").notNull(),
  objectKey: text("object_key").notNull(),
  status: text("status").notNull().default("queued"),
  failureReason: text("failure_reason"),
  extractionPreview: jsonb("extraction_preview").$type<ExtractionPreview>(),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  workerId: text("worker_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.workspaceId, table.id] }),
  unique("uploaded_documents_workspace_checksum_unique").on(
    table.workspaceId,
    table.checksum,
  ),
]);
