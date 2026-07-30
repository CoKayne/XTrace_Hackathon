import assert from "node:assert/strict";
import test from "node:test";

import {
  createMemoryUploadedDocumentsRepository,
  type ExtractionPreview,
} from "../../db/repositories/uploaded-documents";
import { createMemorySourceRegistry } from "../../db/repositories/source-registry";
import { createMemoryDealRegistry } from "../../db/repositories/deal-registry";
import {
  createUploadConfirmationService,
  toUploadPreviewDto,
} from "../../lib/uploads/confirmation";

const preview: ExtractionPreview = {
  candidateCompanyName: "Acme",
  candidateHeadline: "Acme builds carrier software.",
  facts: [{
    text: "Acme serves regional carriers.",
    excerpt: "Acme serves regional carriers.",
    locator: { kind: "text_range", start: 0, end: 30 },
  }],
  extractionMetadata: {
    extractorId: "plain_text_v1",
    extractorVersion: "1",
    extractedAt: "2026-07-29T12:00:00.000Z",
    contentHash: "content-hash",
    inputBytes: 30,
    extractedCharacters: 30,
    truncated: false,
  },
};

async function awaitingUpload(
  repository = createMemoryUploadedDocumentsRepository(),
) {
  await repository.create({
    id: "upload_1",
    workspaceId: "workspace_1",
    filename: "../../acme.md",
    contentType: "text/markdown",
    byteSize: 30,
    checksum: "content-hash",
    objectKey: "private/workspaces/workspace_1/uploads/upload_1/acme.md",
  });
  const claimed = await repository.claimNext("extractor-a");
  assert.ok(claimed);
  assert.equal(await repository.savePreview({
    workspaceId: claimed.workspaceId,
    id: claimed.id,
    workerId: claimed.workerId,
    leaseToken: claimed.leaseToken,
    preview,
  }), true);
  return repository;
}

test("preview DTO exposes only safe fields and candidate Deal choices", async () => {
  const uploads = await awaitingUpload();
  const record = await uploads.get({
    workspaceId: "workspace_1",
    id: "upload_1",
  });
  assert.ok(record);

  const dto = toUploadPreviewDto(record, [{
    dealId: "deal_existing",
    companyName: "Existing Co",
    status: "watchlist",
  }]);
  assert.deepEqual(dto, {
    uploadId: "upload_1",
    status: "awaiting_confirmation",
    filename: "acme.md",
    contentType: "text/markdown",
    preview: {
      candidateCompanyName: "Acme",
      candidateHeadline: "Acme builds carrier software.",
      facts: preview.facts,
    },
    candidateDeals: [{
      dealId: "deal_existing",
      companyName: "Existing Co",
      status: "watchlist",
    }],
    failure: null,
  });
  for (const privateField of [
    "workspaceId",
    "checksum",
    "objectKey",
    "workerId",
    "leaseToken",
    "leaseExpiresAt",
    "providerJobId",
    "recalledMemory",
  ]) {
    assert.equal(privateField in dto, false);
  }
});

test("confirmation promotes an upload to a new Deal once and replays idempotently", async () => {
  const uploads = await awaitingUpload();
  const sources = createMemorySourceRegistry();
  const deals = createMemoryDealRegistry({ sourceRegistry: sources });
  const service = createUploadConfirmationService({
    uploads,
    sources,
    deals,
    now: () => new Date("2026-07-29T12:05:00.000Z"),
  });
  const choice = {
    companyName: "Acme",
    assignment: { kind: "new_deal" as const, dealStatus: "evaluating" as const },
  };

  const first = await service.confirm({
    workspaceId: "workspace_1",
    uploadId: "upload_1",
    assignedByUserId: "user_1",
    choice,
  });
  const replay = await service.confirm({
    workspaceId: "workspace_1",
    uploadId: "upload_1",
    assignedByUserId: "user_1",
    choice,
  });

  assert.deepEqual(replay, first);
  assert.equal(first.status, "confirmed");
  assert.equal((await deals.findForWorkspace({
    workspaceId: "workspace_1",
    dealId: first.dealId,
  }))?.companyName, "Acme");
  assert.equal((await sources.getRevision({
    workspaceId: "workspace_1",
    revisionId: first.sourceRevisionId,
  }))?.contentHash, "content-hash");
  assert.equal((await deals.getAnalysisEligibleSnapshot("workspace_1")).count, 1);
  assert.equal(deals.inspect().assignments.length, 1);
});

test("confirmation rejects a preview without source-backed facts before any registry write", async () => {
  const uploads = createMemoryUploadedDocumentsRepository();
  await uploads.create({
    id: "upload_empty",
    workspaceId: "workspace_1",
    filename: "empty.txt",
    contentType: "text/plain",
    byteSize: 0,
    checksum: "empty-hash",
    objectKey: "private/empty.txt",
  });
  const claim = await uploads.claimNext("extractor-a");
  assert.ok(claim);
  assert.equal(await uploads.savePreview({
    workspaceId: claim.workspaceId,
    id: claim.id,
    workerId: claim.workerId,
    leaseToken: claim.leaseToken,
    preview: { ...preview, facts: [] },
  }), true);
  const sources = createMemorySourceRegistry();
  const deals = createMemoryDealRegistry({ sourceRegistry: sources });
  const service = createUploadConfirmationService({ uploads, sources, deals });

  await assert.rejects(
    service.confirm({
      workspaceId: "workspace_1",
      uploadId: "upload_empty",
      assignedByUserId: "user_1",
      choice: {
        companyName: "Acme",
        assignment: { kind: "new_deal", dealStatus: "evaluating" },
      },
    }),
    /source-backed fact/i,
  );
  assert.equal(sources.inspect().revisions.length, 0);
  assert.equal(deals.inspect().assignments.length, 0);
});

test("existing Deal confirmation preserves the chosen authoritative identity", async () => {
  const uploads = await awaitingUpload();
  const sources = createMemorySourceRegistry();
  const deals = createMemoryDealRegistry({ sourceRegistry: sources });
  await sources.createInitialRevision({
    id: "revision_seed",
    workspaceId: "workspace_1",
    sourceId: "source_seed",
    contentHash: "seed-hash",
    objectKey: "private/seed.txt",
    objectVersion: "seed-hash",
    contentType: "text/plain",
    extractorId: "plain_text_v1",
    extractorVersion: "1",
    extractedAt: "2026-07-29T10:00:00.000Z",
    createdAt: "2026-07-29T10:00:00.000Z",
  });
  await deals.confirmSourceAssignment({
    requestId: "seed-request",
    workspaceId: "workspace_1",
    dealId: "deal_existing",
    companyId: "company_existing",
    companyName: "Existing Co",
    status: "watchlist",
    sourceRevisionId: "revision_seed",
    assignedByUserId: "seed",
    reason: "seed",
    confirmedAt: "2026-07-29T10:00:01.000Z",
  });
  const service = createUploadConfirmationService({
    uploads,
    sources,
    deals,
    now: () => new Date("2026-07-29T12:05:00.000Z"),
  });

  const result = await service.confirm({
    workspaceId: "workspace_1",
    uploadId: "upload_1",
    assignedByUserId: "user_1",
    choice: {
      companyName: "Existing Co",
      assignment: { kind: "existing_deal", dealId: "deal_existing" },
    },
  });

  assert.equal(result.dealId, "deal_existing");
  const deal = await deals.findForWorkspace({
    workspaceId: "workspace_1",
    dealId: "deal_existing",
  });
  assert.equal(deal?.companyId, "company_existing");
  assert.equal(deal?.status, "watchlist");
  assert.equal(deal?.activeSourceRevisionIds.length, 2);
});

test("a conflicting confirmation replay is rejected without changing the receipt", async () => {
  const uploads = await awaitingUpload();
  const sources = createMemorySourceRegistry();
  const deals = createMemoryDealRegistry({ sourceRegistry: sources });
  const service = createUploadConfirmationService({ uploads, sources, deals });
  await service.confirm({
    workspaceId: "workspace_1",
    uploadId: "upload_1",
    assignedByUserId: "user_1",
    choice: {
      companyName: "Acme",
      assignment: { kind: "new_deal", dealStatus: "evaluating" },
    },
  });

  await assert.rejects(
    service.confirm({
      workspaceId: "workspace_1",
      uploadId: "upload_1",
      assignedByUserId: "user_1",
      choice: {
        companyName: "Different Co",
        assignment: { kind: "new_deal", dealStatus: "passed" },
      },
    }),
    /different confirmation/i,
  );
  assert.equal(deals.inspect().assignments.length, 1);
});

test("lease capabilities prevent duplicate completion and expired claims can be reclaimed", async () => {
  let now = new Date("2026-07-29T12:00:00.000Z");
  const uploads = createMemoryUploadedDocumentsRepository({ now: () => now });
  await uploads.create({
    id: "upload_claim",
    workspaceId: "workspace_1",
    filename: "claim.txt",
    contentType: "text/plain",
    byteSize: 5,
    checksum: "claim-hash",
    objectKey: "private/claim.txt",
  });

  const first = await uploads.claimNext("worker-a");
  assert.ok(first);
  assert.equal(await uploads.claimNext("worker-b"), null);
  now = new Date("2026-07-29T12:06:00.000Z");
  const reclaimed = await uploads.claimNext("worker-b");
  assert.ok(reclaimed);
  assert.notEqual(reclaimed.leaseToken, first.leaseToken);
  assert.equal(await uploads.savePreview({
    workspaceId: first.workspaceId,
    id: first.id,
    workerId: first.workerId,
    leaseToken: first.leaseToken,
    preview,
  }), false);
  assert.equal(await uploads.savePreview({
    workspaceId: reclaimed.workspaceId,
    id: reclaimed.id,
    workerId: reclaimed.workerId,
    leaseToken: reclaimed.leaseToken,
    preview,
  }), true);
});
