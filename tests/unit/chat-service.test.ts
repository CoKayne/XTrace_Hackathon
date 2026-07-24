import assert from "node:assert/strict";
import test from "node:test";

import { createGroundedChatService } from "../../lib/chat/service";

test("grounded Chat returns insufficient evidence without browsing", async () => {
  let modelCalled = false;
  const chat = createGroundedChatService({
    searchExistingData: async () => [],
    recallMemory: async () => ({ status: "available", evidence: [] }),
    complete: async () => {
      modelCalled = true;
      return "{}";
    },
  });

  const answer = await chat.answer({
    workspaceId: "demo",
    question: "What happened today to an unknown company?",
    xtraceEnabled: true,
  });

  assert.equal(answer.insufficientEvidence, true);
  assert.equal(answer.citations.length, 0);
  assert.equal(modelCalled, false);
});

test("grounded Chat withholds a local-only answer when requested XTrace recall is unavailable", async () => {
  let modelCalled = false;
  const chat = createGroundedChatService({
    searchExistingData: async () => [{
      text: "Ably provides realtime infrastructure.",
      sources: [{
        id: "source_ably",
        provenance: "source_document",
        title: "Ably pitch deck",
        documentId: "doc_ably",
        excerpt: "Ably provides realtime infrastructure.",
      }],
    }],
    recallMemory: async () => ({
      status: "unavailable" as const,
    }),
    complete: async () => {
      modelCalled = true;
      return "{}";
    },
  });

  const answer = await chat.answer({
    workspaceId: "demo",
    question: "What does Ably provide?",
    xtraceEnabled: true,
  });

  assert.equal(answer.memoryStatus, "unavailable");
  assert.equal(answer.insufficientEvidence, true);
  assert.equal(answer.citations.length, 0);
  assert.match(answer.answer, /local-only answer.*withheld/i);
  assert.equal(modelCalled, false);
});

test("grounded Chat rejects a fabricated claim even when it cites a real source", async () => {
  const source = {
    id: "source_ably",
    provenance: "source_document" as const,
    title: "Ably pitch deck",
    documentId: "doc_ably",
    excerpt: "Ably provides realtime infrastructure.",
  };
  const chat = createGroundedChatService({
    searchExistingData: async () => [{
      text: "Ably provides realtime infrastructure.",
      sources: [source],
    }],
    recallMemory: async () => ({ status: "available", evidence: [] }),
    complete: async () => JSON.stringify({
      claims: [{
        text: "Ably has $100M ARR and signed Acme yesterday.",
        sourceIds: ["source_ably"],
      }],
      insufficientEvidence: false,
    }),
  });

  const answer = await chat.answer({
    workspaceId: "demo",
    question: "What is Ably's ARR?",
    xtraceEnabled: false,
  });

  assert.equal(answer.insufficientEvidence, true);
  assert.equal(answer.citations.length, 0);
  assert.doesNotMatch(answer.answer, /\$100M/);
});

test("grounded Chat never treats recalled XTrace text as stronger than its source excerpt", async () => {
  const source = {
    id: "source_ably",
    provenance: "source_document" as const,
    title: "Ably pitch deck",
    documentId: "doc_ably",
    excerpt: "Ably provides realtime infrastructure.",
  };
  const chat = createGroundedChatService({
    searchExistingData: async () => [],
    recallMemory: async () => ({
      status: "available",
      evidence: [{
        text: "Ably has $100M ARR and signed Acme yesterday.",
        sources: [source],
      }],
    }),
    complete: async () => JSON.stringify({
      claims: [{
        text: "Ably has $100M ARR and signed Acme yesterday.",
        sourceIds: [source.id],
      }],
      insufficientEvidence: false,
    }),
  });

  const answer = await chat.answer({
    workspaceId: "demo",
    question: "What is Ably's ARR?",
    xtraceEnabled: true,
  });

  assert.equal(answer.insufficientEvidence, true);
  assert.equal(answer.citations.length, 0);
  assert.doesNotMatch(answer.answer, /\$100M/);
});

test("grounded Chat returns only exact evidence claims with deduplicated citations", async () => {
  const source = {
    id: "source_ably",
    provenance: "source_document" as const,
    title: "Ably pitch deck",
    documentId: "doc_ably",
    excerpt: "Ably provides realtime infrastructure.",
  };
  const chat = createGroundedChatService({
    searchExistingData: async () => [{
      text: "Ably provides realtime infrastructure.",
      sources: [source],
    }],
    recallMemory: async () => ({ status: "available", evidence: [] }),
    complete: async () => JSON.stringify({
      claims: [{
        text: "Ably provides realtime infrastructure.",
        sourceIds: ["source_ably"],
      }],
      insufficientEvidence: false,
    }),
  });

  const answer = await chat.answer({
    workspaceId: "demo",
    question: "What does Ably provide?",
    xtraceEnabled: true,
  });

  assert.equal(answer.answer, "Ably provides realtime infrastructure.");
  assert.equal(answer.citations.length, 1);
  assert.equal(answer.usedXTrace, false);
  assert.equal(answer.insufficientEvidence, false);
});
