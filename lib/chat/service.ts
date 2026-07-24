import { ClaudeChatAnswerSchema } from "../claude/schemas";
import type { SourceRef } from "../contracts/domain";

export interface ChatEvidence {
  text: string;
  sources: SourceRef[];
}

export interface ChatAnswer {
  answer: string;
  citations: SourceRef[];
  usedXTrace: boolean;
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
  }): Promise<ChatEvidence[]>;
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
      const localEvidence = await dependencies.searchExistingData(input);
      const memoryEvidence = input.xtraceEnabled
        ? await dependencies.recallMemory(input)
        : [];
      const evidence = [...localEvidence, ...memoryEvidence];
      if (evidence.length === 0) {
        return {
          answer: "The existing Deal memory and reports do not contain enough evidence to answer that question.",
          citations: [],
          usedXTrace: input.xtraceEnabled,
          insufficientEvidence: true,
        };
      }

      const sources = new Map<string, SourceRef>();
      for (const item of evidence) {
        for (const source of item.sources) sources.set(source.id, source);
      }
      const text = await dependencies.complete({
        system: "Answer only from supplied evidence. Return JSON with answer, citedSourceIds, and insufficientEvidence.",
        prompt: JSON.stringify({
          question: input.question,
          evidence: evidence.map((item, index) => ({
            index: index + 1,
            text: item.text,
            sourceIds: item.sources.map((source) => source.id),
          })),
        }),
      });
      const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
      const parsed = ClaudeChatAnswerSchema.parse(JSON.parse((fenced?.[1] ?? text).trim()));
      const citations = parsed.citedSourceIds.flatMap((sourceId) => {
        const source = sources.get(sourceId);
        return source ? [source] : [];
      });
      if (!parsed.insufficientEvidence && citations.length === 0) {
        return {
          answer: "The available context did not provide a verifiable citation.",
          citations: [],
          usedXTrace: input.xtraceEnabled,
          insufficientEvidence: true,
        };
      }
      return {
        answer: parsed.answer,
        citations,
        usedXTrace: input.xtraceEnabled,
        insufficientEvidence: parsed.insufficientEvidence,
      };
    },
  };
}
