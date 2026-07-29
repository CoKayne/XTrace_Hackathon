export class IntegrationTransportError extends Error {
  readonly retryable: boolean;

  constructor(input: { retryable: boolean }) {
    super("Integration transport failure");
    this.name = "IntegrationTransportError";
    this.retryable = input.retryable;
  }
}

export function isRetryableTransportStatus(status: number): boolean {
  return status === 429 || status >= 500;
}
