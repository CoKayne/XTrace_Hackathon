import { errorResponse, jsonError, jsonOk } from "../../../lib/api/response";
import { rateLimitRequest } from "../../../lib/api/safety";
import { getIntelligenceRepository } from "../../../db/repositories/intelligence";
import { createGroundedChatService, type ChatEvidence } from "../../../lib/chat/service";
import { createClaudeClient } from "../../../lib/claude/client";
import { ChatRequestSchema } from "../../../lib/contracts/http";
import type { SourceRef } from "../../../lib/contracts/domain";
import { DEMO_DEAL_EVIDENCE } from "../../../lib/corpus/evidence";
import { getPreloadedDocument } from "../../../lib/corpus/manifest";
import {
  evidenceQueryTokens,
  searchDemoEvidence,
} from "../../../lib/demo/search";
import { buildDemoViewModel } from "../../../lib/demo/view-model";
import {
  getXTraceClient,
  isXTraceConfigured,
} from "../../../lib/xtrace/client";
import { createXTraceService } from "../../../lib/xtrace/service";

const WORKSPACE_ID = "workspace_demo";

export const dynamic = "force-dynamic";

function allDemoSources() {
  const sources = new Map<string, SourceRef>();
  for (const evidence of DEMO_DEAL_EVIDENCE) {
    const document = getPreloadedDocument(evidence.documentId);
    if (!document) continue;
    sources.set(evidence.id, {
      id: evidence.id,
      provenance: evidence.provenance,
      title: document.title,
      documentId: evidence.documentId,
      page: evidence.page,
      excerpt: evidence.excerpt,
    });
  }
  for (const deal of buildDemoViewModel().deals) {
    sources.set(`source_${deal.documentId}`, {
      id: `source_${deal.documentId}`,
      provenance: "source_document",
      title: deal.sourceTitle,
      documentId: deal.documentId,
      excerpt: `${deal.sourceTitle} is the supplied source document associated with ${deal.companyName}.`,
    });
    if (deal.fixture) {
      sources.set(deal.fixture.id, {
        id: deal.fixture.id,
      provenance: "demo_fixture",
      title: deal.fixture.label,
      excerpt: [
        deal.fixture.label,
        deal.fixture.meetingSummary,
        `Concerns: ${deal.fixture.concerns.join(" ") || "None recorded."}`,
        `Revisit conditions: ${deal.fixture.revisitConditions.join(" ") || "None recorded."}`,
      ].join(". "),
      });
    }
  }
  return sources;
}

async function searchRuntimeIntelligence(question: string): Promise<ChatEvidence[]> {
  const tokens = evidenceQueryTokens(question);
  if (!tokens.length) return [];
  const repository = getIntelligenceRepository();
  const [events, reports] = await Promise.all([
    repository.listMarketEvents(WORKSPACE_ID),
    repository.listReports(WORKSPACE_ID),
  ]);
  const eventEvidence = events.flatMap((event) => {
    const haystack = [
      event.title,
      event.summary,
      event.eventType,
      ...event.sectors,
      ...event.themes,
    ].join(" ").toLocaleLowerCase();
    const searchableTokens = new Set(evidenceQueryTokens(haystack));
    if (!tokens.every((token) => searchableTokens.has(token))) return [];
    return [{
      text: `${event.title}. ${event.summary}`,
      sources: event.sources,
    }];
  });
  const reportEvidence = reports.flatMap((report) =>
    report.opportunities.flatMap((opportunity) => {
      const haystack = [
        opportunity.dealId,
        opportunity.whyNow,
        opportunity.previousContext,
        opportunity.nextStep,
      ].join(" ").toLocaleLowerCase();
      const searchableTokens = new Set(evidenceQueryTokens(haystack));
      if (!tokens.every((token) => searchableTokens.has(token))) return [];
      return [{
        text: [
          `Existing report ${report.id}.`,
          opportunity.whyNow,
          opportunity.previousContext,
          opportunity.nextStep,
        ].join(" "),
        sources: opportunity.sources,
      }];
    })
  );
  return [...eventEvidence, ...reportEvidence].slice(0, 12);
}

async function recallExistingMemory(question: string): Promise<ChatEvidence[]> {
  if (!isXTraceConfigured()) return [];
  const sourceById = allDemoSources();
  const deals = buildDemoViewModel().deals;
  const service = createXTraceService(getXTraceClient(), {
    workspaceId: WORKSPACE_ID,
  });
  try {
    const contexts = await service.recallDealContext({
      workspaceId: WORKSPACE_ID,
      query: question,
      candidateDealIds: deals.map((deal) => deal.id),
      limit: 8,
    });
    return contexts.flatMap((context) => {
      const sources = [...context.sourceIds, ...context.fixtureIds].flatMap((sourceId) => {
        const source = sourceById.get(sourceId);
        return source ? [source] : [];
      });
      return sources.map((source) => ({
        text: source.excerpt,
        sources: [source],
      }));
    });
  } catch {
    return [];
  }
}

function deterministicCompletion(prompt: string) {
  const parsed = JSON.parse(prompt) as {
    question: string;
    evidence: Array<{ text: string; sourceIds: string[] }>;
  };
  const evidence = parsed.evidence[0];
  return JSON.stringify({
    claims: evidence ? [{
      text: evidence.text,
      sourceIds: evidence.sourceIds,
    }] : [],
    insufficientEvidence: !evidence,
  });
}

export async function POST(request: Request) {
  const rate = await rateLimitRequest(request, "chat", 20);
  if (!rate.allowed) {
    return jsonError(
      "RATE_LIMITED",
      `Too many Chat requests. Try again in ${rate.retryAfterSeconds} seconds.`,
      429,
      true,
    );
  }
  try {
    const input = ChatRequestSchema.parse(await request.json());
    const claude = process.env.ANTHROPIC_API_KEY ? createClaudeClient() : null;
    const service = createGroundedChatService({
      async searchExistingData({ question }) {
        return [
          ...searchDemoEvidence(question),
          ...await searchRuntimeIntelligence(question),
        ];
      },
      async recallMemory({ question }) {
        return recallExistingMemory(question);
      },
      async complete({ system, prompt }) {
        if (!claude) return deterministicCompletion(prompt);
        return claude.complete({
          system,
          messages: [{ role: "user", content: prompt }],
          maxTokens: 1_200,
        });
      },
    });
    return jsonOk(await service.answer({
      workspaceId: WORKSPACE_ID,
      question: input.question,
      xtraceEnabled: input.xtraceEnabled,
    }));
  } catch (error) {
    return errorResponse(error);
  }
}
