export interface ClaudeMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ClaudeClient {
  complete(input: {
    system: string;
    messages: ClaudeMessage[];
    maxTokens?: number;
  }): Promise<string>;
}

export function createClaudeClient(options: {
  apiKey?: string;
  model?: string;
  fetchImpl?: typeof fetch;
} = {}): ClaudeClient {
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
  const model = options.model ?? process.env.ANTHROPIC_MODEL ?? "claude-opus-4-8";
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async complete(input) {
      if (!apiKey) {
        throw new Error("Anthropic is not configured");
      }
      const response = await fetchImpl("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: input.maxTokens ?? 3_000,
          temperature: 0,
          system: input.system,
          messages: input.messages,
        }),
        signal: AbortSignal.timeout(45_000),
      });
      if (!response.ok) {
        throw new Error(`Anthropic request failed with ${response.status}`);
      }
      const body = await response.json() as {
        content?: Array<{ type: string; text?: string }>;
      };
      const text = body.content?.find((block) => block.type === "text")?.text;
      if (!text) throw new Error("Anthropic returned no text content");
      return text;
    },
  };
}
