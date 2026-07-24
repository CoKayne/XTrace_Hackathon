import assert from "node:assert/strict";
import test from "node:test";

import { POST } from "../../app/api/chat/route";

test("Chat API answers the exact 7bridges question shown in the UI", async () => {
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  let response: Response;
  try {
    response = await POST(new Request("http://localhost/api/chat", {
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
  } finally {
    if (anthropicApiKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = anthropicApiKey;
  }

  assert.equal(response.status, 200);
  const payload = await response.json() as {
    data: {
      answer: string;
      citations: Array<{ id: string; provenance: string }>;
      insufficientEvidence: boolean;
    };
  };
  assert.equal(payload.data.insufficientEvidence, false);
  assert.match(payload.data.answer, /Synthetic VC decision record created for the hackathon demo/i);
  assert.match(payload.data.answer, /Decision reason: The team passed because/i);
  assert.ok(payload.data.citations.some((citation) =>
    citation.id === "fixture_7bridges_passed" &&
    citation.provenance === "demo_fixture"
  ));
});

test("Chat API can answer from a synthetic decision reason", async () => {
  const response = await POST(new Request("http://localhost/api/chat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "198.51.100.78",
    },
    body: JSON.stringify({
      question: "broad travel-collaboration proposition",
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
  assert.match(payload.data.answer, /Fellowtrip|travel-collaboration/i);
  assert.ok(payload.data.citations.some((citation) =>
    citation.id === "fixture_fellowtrip_passed"
  ));
});
