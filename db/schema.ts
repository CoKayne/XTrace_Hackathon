import {
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const scanRuns = pgTable("scan_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: text("workspace_id").notNull(),
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
});

export const scanRunSteps = pgTable("scan_run_steps", {
  id: uuid("id").defaultRandom().primaryKey(),
  runId: uuid("run_id").notNull().references(() => scanRuns.id, { onDelete: "cascade" }),
  stage: text("stage").notNull(),
  status: text("status").notNull(),
  warning: text("warning"),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

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

export const companies = pgTable("companies", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const deals = pgTable("deals", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  companyId: text("company_id").notNull(),
  companyName: text("company_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const marketEvents = pgTable("market_events", {
  workspaceId: text("workspace_id").notNull(),
  id: text("id").notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const intelligenceReports = pgTable("intelligence_reports", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  runId: uuid("run_id").notNull().references(() => scanRuns.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  marketSummary: text("market_summary").notNull(),
  opportunities: jsonb("opportunities").notNull().default([]),
  delivery: jsonb("delivery"),
});

export const xtraceIngestJobs = pgTable("xtrace_ingest_jobs", {
  jobId: text("job_id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  dealId: text("deal_id").notNull(),
  sourceIds: jsonb("source_ids").$type<string[]>().notNull().default([]),
  fixtureIds: jsonb("fixture_ids").$type<string[]>().notNull().default([]),
  provenance: text("provenance").notNull(),
  status: text("status").notNull(),
  memoryIds: jsonb("memory_ids").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const xtraceMemoryLinks = pgTable("xtrace_memory_links", {
  memoryId: text("memory_id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  dealId: text("deal_id").notNull(),
  sourceIds: jsonb("source_ids").$type<string[]>().notNull().default([]),
  fixtureIds: jsonb("fixture_ids").$type<string[]>().notNull().default([]),
  provenance: text("provenance").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
