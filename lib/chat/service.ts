import { ClaudeChatAnswerSchema } from "../claude/schemas";
import type { SourceRef } from "../contracts/domain";

export interface ChatEvidence {
  text: string;
  sources: SourceRef[];
}

export type ChatMemoryStatus = "disabled" | "available" | "unavailable";

export type MemoryRecallOutcome =
  | { status: "available"; evidence: ChatEvidence[] }
  | { status: "unavailable" };

export interface ChatAnswer {
  answer: string;
  citations: SourceRef[];
  usedXTrace: boolean;
  memoryStatus: ChatMemoryStatus;
  insufficientEvidence: boolean;
}

interface GroundedChatDependencies {
  searchExistingData(input: {
    workspaceId: string;
    question: string;
  }): Promise<ChatEvidence[]>;
  recallMemory(input: {
    workspaceId: string;
    question: string;
  }): Promise<MemoryRecallOutcome>;
  complete(input: {
    system: string;
    prompt: string;
  }): Promise<string>;
}

export function createGroundedChatService(dependencies: GroundedChatDependencies) {
  return {
    async answer(input: {
      workspaceId: string;
      question: string;
      xtraceEnabled: boolean;
    }): Promise<ChatAnswer> {
      const localEvidence = normalizeEvidence(
        await dependencies.searchExistingData(input),
      );
      const recall = input.xtraceEnabled
        ? await dependencies.recallMemory(input)
        : { status: "disabled" as const };
      if (recall.status === "unavailable") {
        return {
          answer: "XTrace recall is currently unavailable, so the local-only answer was withheld to avoid presenting incomplete memory as complete.",
          citations: [],
          usedXTrace: false,
          memoryStatus: "unavailable",
          insufficientEvidence: true,
        };
      }
      const memoryEvidence = recall.status === "available"
        ? normalizeEvidence(recall.evidence)
        : [];
      const memoryStatus: ChatMemoryStatus = recall.status;
      const evidence = [...localEvidence, ...memoryEvidence];
      if (evidence.length === 0) {
        return {
          answer: "The existing Deal memory and reports do not contain enough evidence to answer that question.",
          citations: [],
          usedXTrace: false,
          memoryStatus,
          insufficientEvidence: true,
        };
      }

      const sources = new Map<string, SourceRef>();
      const evidenceTextBySource = new Map<string, string[]>();
      for (const item of evidence) {
        for (const source of item.sources) {
          sources.set(source.id, source);
          evidenceTextBySource.set(source.id, [
            ...(evidenceTextBySource.get(source.id) ?? []),
            item.text,
          ]);
        }
      }
      const text = await dependencies.complete({
        system: [
          "Answer only from supplied evidence.",
          "Return JSON with claims and insufficientEvidence.",
          "Every claim.text must be copied verbatim from at least one cited evidence item.",
          "Every claim.sourceIds value must identify evidence that contains that exact text.",
          "Do not infer, combine, or add facts that are not explicitly present.",
        ].join(" "),
        prompt: JSON.stringify({
          question: input.question,
          evidence: evidence.map((item, index) => ({
            index: index + 1,
            text: item.text,
            sourceIds: item.sources.map((source) => source.id),
          })),
        }),
      });
      let parsed;
      try {
        const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
        parsed = ClaudeChatAnswerSchema.parse(
          JSON.parse((fenced?.[1] ?? text).trim()),
        );
      } catch {
        return {
          answer: "The model response could not be verified against the available evidence.",
          citations: [],
          usedXTrace: memoryEvidence.length > 0,
          memoryStatus,
          insufficientEvidence: true,
        };
      }
      const supportedClaims = parsed.claims.filter((claim) =>
        claim.sourceIds.length > 0 &&
        claim.sourceIds.every((sourceId) => {
          if (!sources.has(sourceId)) return false;
          return (evidenceTextBySource.get(sourceId) ?? [])
            .some((evidenceText) => evidenceText.includes(claim.text));
        })
      );
      const citationIds = [...new Set(
        supportedClaims.flatMap((claim) => claim.sourceIds),
      )];
      const citations = citationIds.flatMap((sourceId) => {
        const source = sources.get(sourceId);
        return source ? [source] : [];
      });
      if (!parsed.insufficientEvidence && supportedClaims.length === 0) {
        return {
          answer: "The available context did not provide a verifiable claim.",
          citations: [],
          usedXTrace: memoryEvidence.length > 0,
          memoryStatus,
          insufficientEvidence: true,
        };
      }
      return {
        answer: supportedClaims.map((claim) => claim.text).join(" "),
        citations,
        usedXTrace: memoryEvidence.length > 0,
        memoryStatus,
        insufficientEvidence: parsed.insufficientEvidence || supportedClaims.length === 0,
      };
    },
  };
}

function normalizeEvidence(evidence: ChatEvidence[]): ChatEvidence[] {
  const normalized = evidence.flatMap((item) =>
    item.sources.map((source) => ({
      text: source.excerpt,
      sources: [source],
    }))
  );
  return [...new Map(normalized.map((item) => [
    `${item.sources[0].id}:${item.text}`,
    item,
  ])).values()];
}
