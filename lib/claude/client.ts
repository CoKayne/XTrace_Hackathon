export type ClaudeContentBlock =
  | { type: "text"; text: string }
  | {
      type: "image";
      source: {
        type: "base64";
        media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
        data: string;
      };
    };

export interface ClaudeMessage {
  role: "user" | "assistant";
  content: string | ClaudeContentBlock[];
}

export interface ClaudeClient {
  complete(input: {
    system: string;
    messages: ClaudeMessage[];
    maxTokens?: number;
  }): Promise<string>;
}

export class ClaudeCompletionTruncatedError extends Error {
  readonly code = "CLAUDE_MAX_TOKENS";
}

export function createClaudeClient(options: {
  apiKey?: string;
  model?: string;
  fetchImpl?: typeof fetch;
  backoffMs?: number;
} = {}): ClaudeClient {
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
  const model = options.model ?? process.env.ANTHROPIC_MODEL ?? "claude-opus-4-8";
  const fetchImpl = options.fetchImpl ?? fetch;
  const backoffMs = options.backoffMs ?? 2_000;

  return {
    async complete(input) {
      if (!apiKey) {
        throw new Error("Anthropic is not configured");
      }
      let response: Response | undefined;
      let requestError: unknown;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (attempt > 0) {
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
        }
        try {
          response = await fetchImpl("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-api-key": apiKey,
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
              model,
              max_tokens: input.maxTokens ?? 3_000,
              system: input.system,
              messages: input.messages,
            }),
            signal: AbortSignal.timeout(90_000),
          });
          requestError = undefined;
        } catch (error) {
          requestError = error;
          response = undefined;
          continue;
        }
        const retryable = response.status === 429 || response.status >= 500;
        if (!retryable) break;
      }
      if (!response) {
        throw requestError instanceof Error
          ? requestError
          : new Error("Anthropic request could not be completed");
      }
      if (!response.ok) {
        throw new Error(`Anthropic request failed with ${response.status}`);
      }
      const body = await response.json() as {
        stop_reason?: string;
        content?: Array<{ type: string; text?: string }>;
      };
      if (body.stop_reason === "max_tokens") {
        throw new ClaudeCompletionTruncatedError("Anthropic completion reached the max token limit.");
      }
      const text = body.content?.find((block) => block.type === "text")?.text;
      if (!text) throw new Error("Anthropic returned no text content");
      return text;
    },
  };
}
