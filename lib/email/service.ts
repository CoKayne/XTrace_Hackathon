export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  idempotencyKey: string;
}

export interface EmailDelivery {
  id: string;
}

export function createEmailService(options: {
  apiKey?: string;
  from?: string;
  fetchImpl?: typeof fetch;
} = {}) {
  const apiKey = options.apiKey ?? process.env.RESEND_API_KEY;
  const from = options.from ?? process.env.REPORT_FROM_EMAIL;
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async send(message: EmailMessage): Promise<EmailDelivery> {
      if (!apiKey || !from) throw new Error("Email delivery is not configured");
      const response = await fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
          "idempotency-key": message.idempotencyKey,
        },
        body: JSON.stringify({
          from,
          to: message.to,
          subject: message.subject,
          html: message.html,
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) {
        throw new Error(`Email provider request failed with ${response.status}`);
      }
      const body = await response.json() as { id?: string };
      if (!body.id) throw new Error("Email provider returned no message ID");
      return { id: body.id };
    },
  };
}
