import { z } from "zod";

import { RunStatusSchema } from "./domain";

export const CreateRunRequestSchema = z.object({
  xtraceEnabled: z.boolean().default(true),
});

export const RunSummarySchema = z.object({
  id: z.string().min(1),
  status: RunStatusSchema,
  mode: z.enum(["xtrace", "structured"]),
  windowDays: z.literal(14),
  createdAt: z.string().datetime(),
  currentStage: z.string().nullable(),
  warningCount: z.number().int().nonnegative(),
});

export const ChatRequestSchema = z.object({
  question: z.string().trim().min(2).max(2_000),
  xtraceEnabled: z.boolean().default(true),
});

export const ApiErrorCodeSchema = z.enum([
  "VALIDATION_ERROR",
  "NOT_FOUND",
  "CONFLICT",
  "RATE_LIMITED",
  "INTEGRATION_UNAVAILABLE",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "INTERNAL_ERROR",
]);

export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

export const ApiErrorSchema = z.object({
  error: z.object({
    code: ApiErrorCodeSchema,
    message: z.string().min(1),
    retryable: z.boolean(),
  }),
});

export type CreateRunRequest = z.infer<typeof CreateRunRequestSchema>;
export type RunSummary = z.infer<typeof RunSummarySchema>;
export type ChatRequest = z.infer<typeof ChatRequestSchema>;
