import assert from "node:assert/strict";
import test from "node:test";

import { POST } from "../../app/api/chat/route";

test("Chat API answers the exact 7bridges question shown in the UI", async () => {
  const response = await POST(new Request("http://localhost/api/chat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "198.51.100.77",
    },
    body: JSON.stringify({
      question: "Why did we mark 7bridges as passed?",
      xtraceEnabled: false,
    }),
  }));

  assert.equal(response.status, 200);
  const payload = await response.json() as {
    data: {
      answer: string;
      citations: Array<{ id: string }>;
      insufficientEvidence: boolean;
    };
  };
  assert.equal(payload.data.insufficientEvidence, false);
  assert.match(payload.data.answer, /7bridges|logistics|paid acquisition/i);
  assert.ok(payload.data.citations.length > 0);
});
