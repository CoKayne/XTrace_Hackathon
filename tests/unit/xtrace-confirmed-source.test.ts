import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryXTraceLineageRepository } from "../../db/repositories/xtrace-lineage";
import {
  createMemoryUploadedDocumentsRepository,
  type ExtractionPreview,
} from "../../db/repositories/uploaded-documents";
import { createXTraceService } from "../../lib/xtrace/service";
import {
  processConfirmedSource,
  selectConfirmedSourceBundle,
} from "../../worker/ingest-confirmed-source";

const preview: ExtractionPreview = {
  candidateCompanyName: "Acme",
  candidateHeadline: "Acme builds software.",
  facts: [{
    text: "Acme has ten customers.",
    excerpt: "Acme has ten customers.",
    locator: { kind: "text_range", start: 0, end: 23 },
  }],
  extractionMetadata: {
    extractorId: "plain_text_v1",
    extractorVersion: "1",
    extractedAt: "2026-07-29T12:00:00.000Z",
    contentHash: "hash",
    inputBytes: 23,
    extractedCharacters: 23,
    truncated: false,
  },
};

test("confirmed-source ingest persists exact revision lineage in jobs and recalled memory", async () => {
  const lineage = createMemoryXTraceLineageRepository();
  const service = createXTraceService({
    ingest: async () => ({
      id: "job_confirmed",
      status: "succeeded",
      result: {
        memories_created: [{
          id: "memory_confirmed",
          type: "fact",
          text: "Acme has ten customers.",
        }],
      },
    }),
  } as never, {
    workspaceId: "workspace_1",
    lineageRepository: lineage,
  });

  await service.ingestDealMemory({
    dealId: "deal_1",
    companyName: "Acme",
    status: "evaluating",
    facts: [{
      text: "Acme has ten customers.",
      sources: [{
        id: "evidence_upload_1_0",
        documentId: "source_upload_1",
        provenance: "source_document",
        title: "acme.txt",
        excerpt: "Acme has ten customers.",
      }],
    }],
    interactions: [],
  }, {
    sourceRevisionIds: ["revision_upload_1"],
    sourceIds: ["source_upload_1"],
    fixtureIds: [],
  });

  assert.deepEqual(await lineage.resolve({
    workspaceId: "workspace_1",
    memoryId: "memory_confirmed",
  }), {
    workspaceId: "workspace_1",
    memoryId: "memory_confirmed",
    dealId: "deal_1",
    sourceRevisionIds: ["revision_upload_1"],
    sourceIds: ["source_upload_1"],
    fixtureIds: [],
    provenance: "source_document",
  });
});

test("confirmed-source ingest excludes evidence and interactions from other revisions", () => {
  const selected = selectConfirmedSourceBundle({
    dealId: "deal_1",
    companyName: "Acme",
    status: "evaluating",
    facts: [
      {
        text: "New upload fact.",
        sources: [{
          id: "evidence_new",
          documentId: "source_upload_1",
          provenance: "source_document",
          title: "new.txt",
          excerpt: "New upload fact.",
        }],
      },
      {
        text: "Older source fact.",
        sources: [{
          id: "evidence_old",
          documentId: "source_old",
          provenance: "source_document",
          title: "old.txt",
          excerpt: "Older source fact.",
        }],
      },
    ],
    interactions: [{
      id: "interaction_old",
      occurredAt: "2026-07-01T00:00:00.000Z",
      summary: "Old meeting",
      decisionReason: "Old decision",
      concerns: [],
      revisitConditions: [],
      provenance: "demo_fixture",
      label: "Sample decision record",
    }],
  }, "source_upload_1");

  assert.equal(selected.facts.length, 1);
  assert.deepEqual(
    selected.facts[0].sources.map((source) => source.documentId),
    ["source_upload_1"],
  );
  assert.deepEqual(selected.interactions, []);
});

test("only a confirmed claim reaches XTrace and success is lease-token guarded", async () => {
  const uploads = createMemoryUploadedDocumentsRepository();
  await uploads.create({
    id: "upload_1",
    workspaceId: "workspace_1",
    filename: "acme.txt",
    contentType: "text/plain",
    byteSize: 23,
    checksum: "hash",
    objectKey: "private/acme.txt",
  });
  assert.equal(await uploads.claimNextConfirmed("worker-a"), null);
  await stageConfirmed(uploads, {
    id: "upload_1",
    dealId: "deal_1",
    sourceId: "source_upload_1",
    sourceRevisionId: "revision_upload_1",
  });
  const claimed = await uploads.claimNextConfirmed("worker-a");
  assert.ok(claimed);
  const calls: string[] = [];

  await processConfirmedSource(claimed, {
    loadBundle: async () => ({
      dealId: "deal_1",
      companyName: "Acme",
      status: "evaluating",
      facts: [{
        text: "Acme has ten customers.",
        sources: [{
          id: "evidence_upload_1_0",
          documentId: "source_upload_1",
          provenance: "source_document",
          title: "acme.txt",
          excerpt: "Acme has ten customers.",
        }],
      }],
      interactions: [],
    }),
    ingest: async (_bundle, exactLineage) => {
      calls.push(JSON.stringify(exactLineage));
      return {
        dealId: "deal_1",
        jobId: "job_1",
        status: "succeeded",
        memoryIds: ["memory_1"],
      };
    },
    complete: (input) => uploads.completeConfirmed(input),
  });

  assert.deepEqual(calls.map((value) => JSON.parse(value)), [{
    sourceRevisionIds: ["revision_upload_1"],
    sourceIds: ["source_upload_1"],
    fixtureIds: [],
  }]);
  assert.equal((await uploads.get({
    workspaceId: "workspace_1",
    id: "upload_1",
  }))?.status, "ready");
});

test("XTrace failure returns the upload to a visible retryable confirmed state", async () => {
  const uploads = createMemoryUploadedDocumentsRepository();
  await uploads.create({
    id: "upload_failure",
    workspaceId: "workspace_1",
    filename: "failure.txt",
    contentType: "text/plain",
    byteSize: 23,
    checksum: "failure-hash",
    objectKey: "private/failure.txt",
  });
  await stageConfirmed(uploads, {
    id: "upload_failure",
    dealId: "deal_failure",
    sourceId: "source_failure",
    sourceRevisionId: "revision_failure",
  });
  const claimed = await uploads.claimNextConfirmed("worker-a");
  assert.ok(claimed);

  await assert.rejects(processConfirmedSource(claimed, {
    loadBundle: async () => ({
      dealId: "deal_failure",
      companyName: "Failure",
      status: "watchlist",
      facts: [{
        text: "Failure source fact.",
        sources: [{
          id: "evidence_failure_0",
          documentId: "source_failure",
          provenance: "source_document",
          title: "failure.txt",
          excerpt: "Failure source fact.",
        }],
      }],
      interactions: [],
    }),
    ingest: async () => {
      throw new Error("provider secret diagnostic");
    },
    complete: (input) => uploads.completeConfirmed(input),
    fail: (input) => uploads.failConfirmed(input),
  }));

  const failed = await uploads.get({
    workspaceId: "workspace_1",
    id: "upload_failure",
  });
  assert.equal(failed?.status, "confirmed");
  assert.equal(failed?.failureReason, "Memory ingestion failed. Retry is available.");
  assert.ok(await uploads.claimNextConfirmed("worker-b"));
});

async function stageConfirmed(
  uploads: ReturnType<typeof createMemoryUploadedDocumentsRepository>,
  input: {
    id: string;
    dealId: string;
    sourceId: string;
    sourceRevisionId: string;
  },
) {
  const extraction = await uploads.claimNext("extractor");
  assert.ok(extraction);
  assert.equal(await uploads.savePreview({
    workspaceId: extraction.workspaceId,
    id: input.id,
    workerId: extraction.workerId,
    leaseToken: extraction.leaseToken,
    preview,
  }), true);
  await uploads.markConfirmed({
    workspaceId: "workspace_1",
    id: input.id,
    confirmationFingerprint: `fingerprint:${input.id}`,
    dealId: input.dealId,
    sourceId: input.sourceId,
    sourceRevisionId: input.sourceRevisionId,
  });
}
