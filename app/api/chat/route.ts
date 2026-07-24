import { errorResponse, jsonError, jsonOk } from "../../../lib/api/response";
import { rateLimitRequest } from "../../../lib/api/safety";
import { getIntelligenceRepository } from "../../../db/repositories/intelligence";
import {
  createGroundedChatService,
  type ChatEvidence,
  type MemoryRecallOutcome,
} from "../../../lib/chat/service";
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
import { sanitizeReportOpportunities } from "../../../lib/reports/next-step-policy";
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
        `Decision reason: ${deal.fixture.decisionReason}`,
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
  const companyByDeal = new Map(
    buildDemoViewModel().deals.map((deal) => [deal.id, deal.companyName]),
  );
  const reportEvidence = reports.flatMap((report, reportIndex) =>
    sanitizeReportOpportunities(report.opportunities).flatMap((opportunity) => {
      const companyName = companyByDeal.get(opportunity.dealId) ?? opportunity.dealId;
      const haystack = [
        opportunity.dealId,
        companyName,
        opportunity.whyNow,
        opportunity.previousContext,
        opportunity.nextStep,
        "report recommendation recommend recommended previous context next step",
        reportIndex === 0 ? "latest" : "",
      ].join(" ").toLocaleLowerCase();
      const searchableTokens = new Set(evidenceQueryTokens(haystack));
      if (!tokens.every((token) => searchableTokens.has(token))) return [];
      const fields = [
        {
          key: "why-now",
          label: "why now",
          text: opportunity.whyNow,
        },
        {
          key: "previous-context",
          label: "previous context",
          text: opportunity.previousContext,
        },
        {
          key: "recommendation",
          label: "recommendation",
          text: opportunity.nextStep,
        },
      ];
      const normalizedQuestion = question.toLocaleLowerCase();
      if (/\b(recommend|recommended|recommendation|next\s+step)\b/.test(normalizedQuestion)) {
        fields.unshift(fields.pop()!);
      } else if (/\b(previous|history|context)\b/.test(normalizedQuestion)) {
        fields.unshift(fields.splice(1, 1)[0]);
      }
      const conclusionEvidence = fields.map((field) => ({
        text: field.text,
        sources: [{
          id: `report:${report.id}:opportunity:${opportunity.dealId}:${field.key}`,
          provenance: "model_inference" as const,
          title: `Persisted report ${field.label} · ${companyName} · ${report.id}`,
          excerpt: field.text,
        }],
      }));
      const supportingEvidence = opportunity.sources.map((source) => ({
        text: source.excerpt,
        sources: [source],
      }));
      return [...conclusionEvidence, ...supportingEvidence];
    })
  );
  return [...eventEvidence, ...reportEvidence].slice(0, 12);
}

async function recallExistingMemory(question: string): Promise<MemoryRecallOutcome> {
  if (!isXTraceConfigured()) return { status: "unavailable" };
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
    const evidence = contexts.flatMap((context) => {
      const sources = [...context.sourceIds, ...context.fixtureIds].flatMap((sourceId) => {
        const source = sourceById.get(sourceId);
        return source ? [source] : [];
      });
      return sources.map((source) => ({
        text: source.excerpt,
        sources: [source],
      }));
    });
    return { status: "available", evidence };
  } catch {
    return { status: "unavailable" };
  }
}

function deterministicCompletion(prompt: string) {
  const parsed = JSON.parse(prompt) as {
    question: string;
    evidence: Array<{ text: string; sourceIds: string[] }>;
  };
  const normalizedQuestion = parsed.question.trim().toLocaleLowerCase();
  const questionTokens = evidenceQueryTokens(parsed.question);
  const evidence = parsed.evidence.find((item) =>
    item.text.toLocaleLowerCase().includes(normalizedQuestion)
  ) ?? parsed.evidence
    .map((item) => ({
      item,
      score: questionTokens.filter((token) =>
        evidenceQueryTokens(`${item.text} ${item.sourceIds.join(" ")}`)
          .includes(token)
      ).length,
    }))
    .sort((left, right) => right.score - left.score)[0]?.item;
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
