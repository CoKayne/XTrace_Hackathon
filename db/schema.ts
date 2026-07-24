import {
  integer,
  jsonb,
  pgTable,
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

