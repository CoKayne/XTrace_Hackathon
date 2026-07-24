import { z } from "zod";

export const ClaudeReasonedMatchSchema = z.object({
  dealId: z.string().min(1),
  whyNow: z.string().min(1),
  previousContext: z.string().min(1),
  positiveImplications: z.array(z.string()),
  negativeImplications: z.array(z.string()),
  nextStep: z.string().min(1),
  citedSourceIds: z.array(z.string()).min(1),
  demoFixtureIds: z.array(z.string()),
  scoreInputs: z.object({
    eventRelevance: z.number().min(0).max(1),
    dealRelevance: z.number().min(0).max(1),
    priorContextStrength: z.number().min(0).max(1),
    evidenceQuality: z.number().min(0).max(1),
  }),
  claimSourceIds: z.record(z.string(), z.array(z.string()).min(1)),
});

export const ClaudeReasonedMatchesSchema = z.array(ClaudeReasonedMatchSchema);

export const ClaudeChatClaimSchema = z.object({
  text: z.string().min(1),
  sourceIds: z.array(z.string()).min(1),
});

export const ClaudeChatAnswerSchema = z.object({
  claims: z.array(ClaudeChatClaimSchema),
  insufficientEvidence: z.boolean(),
});
