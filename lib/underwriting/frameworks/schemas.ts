import { z } from "zod";

export {
  ClaudeFrameworkLensOutputSchema,
  type ClaudeFrameworkLensOutput,
} from "../../claude/schemas";

const IdSchema = z.string().min(1).refine(
  (value) => value.trim() === value,
  "IDs cannot have surrounding whitespace",
);

export const FrameworkCardSchema = z.strictObject({
  id: IdSchema,
  version: z.string().min(1),
  title: z.string().min(1),
  synthetic: z.boolean(),
  publicationStatus: z.enum(["draft", "published", "retired"]),
  attribution: z.string().min(1),
  approvedNeutralParaphrase: z.string().min(1),
  locator: z.string().min(1),
  limitations: z.array(z.string().min(1)),
  rightsStatus: z.string().min(1),
  formalDecisionWeight: z.string().min(1),
});

export type FrameworkCard = z.infer<typeof FrameworkCardSchema>;
