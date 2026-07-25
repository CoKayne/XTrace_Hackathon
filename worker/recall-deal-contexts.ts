import type { DealMemoryBundle } from "../lib/contracts/domain";
import type {
  MemoryContext,
  RecallDealContextInput,
} from "../lib/xtrace/service";

export interface DealRecallService {
  recallDealContext(input: RecallDealContextInput): Promise<MemoryContext[]>;
}

export interface DealRecallResult {
  contextsByDeal: Map<string, MemoryContext[]>;
  failures: Array<{ dealId: string; message: string }>;
}

export async function recallAllDealContexts(input: {
  workspaceId: string;
  runId: string;
  bundles: DealMemoryBundle[];
  service?: DealRecallService;
}): Promise<DealRecallResult> {
  const contextsByDeal = new Map<string, MemoryContext[]>();
  const failures: DealRecallResult["failures"] = [];

  if (!input.service) {
    return {
      contextsByDeal,
      failures: input.bundles.map((bundle) => ({
        dealId: bundle.dealId,
        message: "XTRACE_SERVICE_UNAVAILABLE",
      })),
    };
  }

  for (const bundle of input.bundles) {
    try {
      const contexts = await input.service.recallDealContext({
        workspaceId: input.workspaceId,
        runId: `${input.runId}:${bundle.dealId}`,
        query: dealRecallQuery(bundle),
        candidateDealIds: [bundle.dealId],
        limit: 20,
      });
      contextsByDeal.set(
        bundle.dealId,
        contexts.filter((context) => context.dealId === bundle.dealId),
      );
    } catch (error) {
      failures.push({
        dealId: bundle.dealId,
        message: safeRecallFailure(error),
      });
    }
  }

  return { contextsByDeal, failures };
}

export function dealRecallQuery(bundle: DealMemoryBundle): string {
  // Template-only queries rank poorly: every Deal's memories share the same
  // boilerplate phrasing, so the query must carry this Deal's own decision
  // content for similarity search to surface this Deal's memories first.
  const decisionContext = bundle.interactions.flatMap((interaction) => [
    interaction.summary,
    interaction.decisionReason,
    ...interaction.concerns,
    ...interaction.revisitConditions,
  ]);
  const factTexts = bundle.facts.map((fact) => fact.text);
  return [
    bundle.companyName,
    "investment decision",
    ...decisionContext,
    ...factTexts,
  ].join(" · ").slice(0, 4_000);
}

function safeRecallFailure(error: unknown): string {
  if (
    error
    && typeof error === "object"
    && "code" in error
    && typeof error.code === "string"
    && /^[A-Z0-9_]{1,80}$/.test(error.code)
  ) {
    return error.code;
  }
  if (error instanceof Error && /^[A-Za-z][A-Za-z0-9]+$/.test(error.name)) {
    return error.name.slice(0, 80);
  }
  return "XTRACE_RECALL_FAILED";
}
