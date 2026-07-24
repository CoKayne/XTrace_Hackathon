import { z } from "zod";

export const ProvenanceSchema = z.enum([
  "source_document",
  "public_web",
  "demo_fixture",
  "model_inference",
]);

export const DealStatusSchema = z.preprocess(
  (value) => value === "interested" ? "watchlist" : value,
  z.enum(["screening", "watchlist", "evaluating", "passed", "invested"]),
);

export const DEMO_FIXTURE_LABEL = "Synthetic VC decision record created for the hackathon demo" as const;

export const RunStatusSchema = z.enum([
  "queued",
  "running",
  "partial",
  "completed",
  "failed",
]);

export const SourceRefSchema = z.object({
  id: z.string().min(1),
  provenance: ProvenanceSchema,
  title: z.string().min(1),
  url: z.string().url().optional(),
  documentId: z.string().min(1).optional(),
  page: z.number().int().positive().optional(),
  publisher: z.string().min(1).optional(),
  publishedAt: z.string().datetime().optional(),
  excerpt: z.string().min(1),
});

export const DealFactSchema = z.object({
  text: z.string().min(1),
  sources: z.array(SourceRefSchema).min(1),
});

export const DealInteractionSchema = z.object({
  id: z.string().min(1),
  occurredAt: z.string().datetime(),
  summary: z.string().min(1),
  concerns: z.array(z.string()),
  revisitConditions: z.array(z.string()),
  provenance: z.literal("demo_fixture"),
  label: z.literal(DEMO_FIXTURE_LABEL),
});

export const DealMemoryBundleSchema = z.object({
  dealId: z.string().min(1),
  companyName: z.string().min(1),
  status: DealStatusSchema,
  facts: z.array(DealFactSchema),
  interactions: z.array(DealInteractionSchema),
});

export const MarketEventSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  eventType: z.string().min(1),
  sectors: z.array(z.string()),
  themes: z.array(z.string()),
  summary: z.string().min(1),
  positiveImplications: z.array(z.string()),
  negativeImplications: z.array(z.string()),
  publishedAt: z.string().datetime(),
  confidence: z.enum(["low", "medium", "high"]),
  sources: z.array(SourceRefSchema).min(1),
});

export const OpportunityReportItemSchema = z.object({
  rank: z.number().int().min(1).max(5),
  dealId: z.string().min(1),
  confidence: z.enum(["medium", "high"]),
  score: z.number().min(0).max(1),
  whyNow: z.string().min(1),
  previousContext: z.string().min(1),
  implications: z.object({
    positive: z.array(z.string()),
    negative: z.array(z.string()),
  }),
  nextStep: z.string().min(1),
  sources: z.array(SourceRefSchema).min(1),
  demoFixtureIds: z.array(z.string()),
});

export type Provenance = z.infer<typeof ProvenanceSchema>;
export type DealStatus = z.infer<typeof DealStatusSchema>;
export type RunStatus = z.infer<typeof RunStatusSchema>;
export type SourceRef = z.infer<typeof SourceRefSchema>;
export type DealFact = z.infer<typeof DealFactSchema>;
export type DealInteraction = z.infer<typeof DealInteractionSchema>;
export type DealMemoryBundle = z.infer<typeof DealMemoryBundleSchema>;
export type MarketEvent = z.infer<typeof MarketEventSchema>;
export type OpportunityReportItem = z.infer<typeof OpportunityReportItemSchema>;
