import assert from "node:assert/strict";
import test from "node:test";

import {
  createMemoryUploadedDocumentsRepository,
  type ExtractionPreview,
  type UploadedDocumentsRepository,
} from "../../db/repositories/uploaded-documents";
import { createMemorySourceRegistry } from "../../db/repositories/source-registry";
import {
  createMemoryDealRegistry,
  sourceRevisionFingerprint,
} from "../../db/repositories/deal-registry";
import {
  createMemoryEvidencePacksRepository,
} from "../../db/repositories/evidence-packs";
import {
  createUploadConfirmationService,
  toUploadPreviewDto,
} from "../../lib/uploads/confirmation";
import {
  normalizeSourceEvidence,
} from "../../lib/underwriting/evidence/normalization";

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
  extractionPreview = preview,
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
    preview: extractionPreview,
  }), true);
  return repository;
}

async function confirmEvidence(
  facts: ExtractionPreview["facts"],
) {
  const uploads = await awaitingUpload(
    createMemoryUploadedDocumentsRepository(),
    { ...preview, facts },
  );
  const sources = createMemorySourceRegistry();
  const deals = createMemoryDealRegistry({ sourceRegistry: sources });
  const evidencePacks = createMemoryEvidencePacksRepository();
  const service = createUploadConfirmationService({
    uploads,
    sources,
    deals,
    evidencePacks,
    now: () => new Date("2026-07-29T12:05:00.000Z"),
  });
  const result = await service.confirm({
    workspaceId: "workspace_1",
    uploadId: "upload_1",
    assignedByUserId: "user_1",
    choice: {
      companyName: "Acme",
      assignment: { kind: "new_deal", dealStatus: "evaluating" },
    },
  });
  return evidencePacks.listSourceEvidence({
    workspaceId: "workspace_1",
    dealId: result.dealId,
    sourceRevisionIds: [result.sourceRevisionId],
  });
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

test("memory confirmation bridges exact source tuples into canonical underwriting evidence", async () => {
  const structuredPreview: ExtractionPreview = {
    ...preview,
    facts: [
      {
        text:
          "ARR was $2,000,000 USD from 2025-01-01 through 2025-12-31.",
        excerpt:
          "ARR was $2,000,000 USD from 2025-01-01 through 2025-12-31.",
        locator: { kind: "text_range", start: 0, end: 58 },
        structured: {
          field: "ARR",
          value: "$2,000,000",
          unit: "currency",
          currency: "USD",
          periodStart: "2025-01-01",
          periodEnd: "2025-12-31",
          publishedAt: null,
          eventAt: null,
        },
      },
      {
        text: "Acme has strong product-market fit.",
        excerpt: "Acme has strong product-market fit.",
        locator: { kind: "text_range", start: 42, end: 77 },
        structured: {
          field: "PMF",
          value: "strong product-market fit",
          unit: null,
          currency: null,
          periodStart: null,
          periodEnd: null,
          publishedAt: null,
          eventAt: null,
        },
      },
    ],
  };
  const uploads = await awaitingUpload(
    createMemoryUploadedDocumentsRepository(),
    structuredPreview,
  );
  const sources = createMemorySourceRegistry();
  const deals = createMemoryDealRegistry({ sourceRegistry: sources });
  const evidencePacks = createMemoryEvidencePacksRepository();
  const service = createUploadConfirmationService({
    uploads,
    sources,
    deals,
    evidencePacks,
    now: () => new Date("2026-07-29T12:05:00.000Z"),
  });

  const result = await service.confirm({
    workspaceId: "workspace_1",
    uploadId: "upload_1",
    assignedByUserId: "user_1",
    choice: {
      companyName: "Acme",
      assignment: { kind: "new_deal", dealStatus: "evaluating" },
    },
  });
  const confirmed = await uploads.get({
    workspaceId: "workspace_1",
    id: "upload_1",
  });
  assert.ok(confirmed?.sourceId);

  const evidence = await evidencePacks.listSourceEvidence({
    workspaceId: "workspace_1",
    dealId: result.dealId,
    sourceRevisionIds: [result.sourceRevisionId],
  });
  assert.deepEqual(
    evidence.map((item) => ({
      sourceId: item.sourceId,
      sourceRevisionId: item.sourceRevisionId,
      field: item.field,
      value: item.value,
      acceptedForGate: item.acceptedForGate,
    })),
    [
      {
        sourceId: confirmed.sourceId,
        sourceRevisionId: result.sourceRevisionId,
        field: "ARR",
        value: "$2,000,000",
        acceptedForGate: true,
      },
      {
        sourceId: confirmed.sourceId,
        sourceRevisionId: result.sourceRevisionId,
        field: "unstructured_source_fact",
        value: "Acme has strong product-market fit.",
        acceptedForGate: false,
      },
    ],
  );
  const normalizedArr = normalizeSourceEvidence(evidence[0]!);
  assert.equal(normalizedArr.field, "arr");
  assert.equal(normalizedArr.value, "2000000");
  assert.equal(normalizedArr.currency, "USD");
});

test("confirmation keeps inferred financial metadata out of formal gates", async () => {
  const evidence = await confirmEvidence([{
    text: "ARR was $2,000,000 for calendar 2025.",
    excerpt: "ARR was $2,000,000 for calendar 2025.",
    locator: { kind: "text_range", start: 0, end: 41 },
    structured: {
      field: "ARR",
      value: "$2,000,000",
      unit: "currency",
      currency: "USD",
      periodStart: "2025-01-01",
      periodEnd: "2025-12-31",
      publishedAt: null,
      eventAt: null,
    },
  }]);

  assert.deepEqual(
    evidence.map(({ field, value, acceptedForGate }) => ({
      field,
      value,
      acceptedForGate,
    })),
    [{
      field: "unstructured_source_fact",
      value: "ARR was $2,000,000 for calendar 2025.",
      acceptedForGate: false,
    }],
  );
});

test("confirmation fails closed for unsupported structured semantics and values", async () => {
  const cases = [
    {
      label: "PMF variant",
      field: "Product/Market Fit Score",
      value: "strong",
      unit: null,
      currency: null,
      excerpt: "Product/Market Fit Score: strong.",
      periodStart: null,
      periodEnd: null,
      publishedAt: null,
      eventAt: null,
    },
    {
      label: "unlisted financial metric",
      field: "Monthly Recurring Revenue",
      value: "$200,000",
      unit: "currency",
      currency: "USD",
      excerpt: "Monthly Recurring Revenue was $200,000 USD.",
      periodStart: null,
      periodEnd: null,
      publishedAt: null,
      eventAt: null,
    },
    {
      label: "abbreviated native value",
      field: "ARR",
      value: "$2M",
      unit: "currency",
      currency: "USD",
      excerpt: "ARR was $2M USD.",
      periodStart: null,
      periodEnd: null,
      publishedAt: null,
      eventAt: null,
    },
    {
      label: "invented currency code",
      field: "ARR",
      value: "$2,000,000",
      unit: "currency",
      currency: "ABC",
      excerpt: "ARR was $2,000,000 ABC.",
      periodStart: null,
      periodEnd: null,
      publishedAt: null,
      eventAt: null,
    },
    {
      label: "currency code only appears inside another word",
      field: "ARR",
      value: "$2,000,000",
      unit: "currency",
      currency: "USD",
      excerpt: "ARR was $2,000,000 in a USDA filing.",
      periodStart: null,
      periodEnd: null,
      publishedAt: null,
      eventAt: null,
    },
    {
      label: "field label only appears inside another word",
      field: "ARR",
      value: "$2,000,000",
      unit: "currency",
      currency: "USD",
      excerpt: "The company carried $2,000,000 USD.",
      periodStart: null,
      periodEnd: null,
      publishedAt: null,
      eventAt: null,
    },
    {
      label: "invalid calendar date",
      field: "ARR",
      value: "$2,000,000",
      unit: "currency",
      currency: "USD",
      excerpt:
        "ARR was $2,000,000 USD from 2025-02-30 through 2025-12-31.",
      periodStart: "2025-02-30",
      periodEnd: "2025-12-31",
      publishedAt: null,
      eventAt: null,
    },
    {
      label: "invalid as-of timestamp",
      field: "ARR",
      value: "$2,000,000",
      unit: "currency",
      currency: "USD",
      excerpt:
        "ARR was $2,000,000 USD as of 2025-02-30T12:00:00.000Z.",
      periodStart: null,
      periodEnd: null,
      publishedAt: null,
      eventAt: "2025-02-30T12:00:00.000Z",
    },
    {
      label: "invalid ISO offset",
      field: "ARR",
      value: "$2,000,000",
      unit: "currency",
      currency: "USD",
      excerpt:
        "ARR was $2,000,000 USD as of 2025-01-01T12:00:00.000+19:00.",
      periodStart: null,
      periodEnd: null,
      publishedAt: null,
      eventAt: "2025-01-01T12:00:00.000+19:00",
    },
  ] as const;
  const evidence = await confirmEvidence(cases.map((item, index) => ({
    text: item.excerpt,
    excerpt: item.excerpt,
    locator: {
      kind: "text_range" as const,
      start: index * 100,
      end: index * 100 + item.excerpt.length,
    },
    structured: {
      field: item.field,
      value: item.value,
      unit: item.unit,
      currency: item.currency,
      periodStart: item.periodStart,
      periodEnd: item.periodEnd,
      publishedAt: item.publishedAt,
      eventAt: item.eventAt,
    },
  })));

  assert.deepEqual(
    evidence.map(({ field, acceptedForGate }) => ({
      field,
      acceptedForGate,
    })),
    cases.map(() => ({
      field: "unstructured_source_fact",
      acceptedForGate: false,
    })),
  );
});

test("atomic upload adapters receive exact locator and structured evidence", async () => {
  const baseUploads = await awaitingUpload(
    createMemoryUploadedDocumentsRepository(),
    {
      ...preview,
      facts: [{
        text:
          "ARR was $2,000,000 USD from 2025-01-01 through 2025-12-31.",
        excerpt:
          "ARR was $2,000,000 USD from 2025-01-01 through 2025-12-31.",
        locator: { kind: "text_range", start: 0, end: 58 },
        structured: {
          field: "ARR",
          value: "$2,000,000",
          unit: "currency",
          currency: "USD",
          periodStart: "2025-01-01",
          periodEnd: "2025-12-31",
          publishedAt: null,
          eventAt: null,
        },
      }],
    },
  );
  let received:
    | Parameters<
      NonNullable<UploadedDocumentsRepository["promoteAtomically"]>
    >[0]["evidence"][number]
    | undefined;
  const uploads: UploadedDocumentsRepository = {
    ...baseUploads,
    async promoteAtomically(input) {
      received = input.evidence[0];
      return {
        ...(await baseUploads.get({
          workspaceId: input.workspaceId,
          id: input.uploadId,
        }))!,
        status: "confirmed",
      };
    },
  };
  const sources = createMemorySourceRegistry();
  const deals = createMemoryDealRegistry({ sourceRegistry: sources });
  const service = createUploadConfirmationService({
    uploads,
    sources,
    deals,
    evidencePacks: createMemoryEvidencePacksRepository(),
  });

  await service.confirm({
    workspaceId: "workspace_1",
    uploadId: "upload_1",
    assignedByUserId: "user_1",
    choice: {
      companyName: "Acme",
      assignment: { kind: "new_deal", dealStatus: "evaluating" },
    },
  });

  assert.deepEqual(received?.locator, {
    kind: "text_range",
    start: 0,
    end: 58,
    excerpt:
      "ARR was $2,000,000 USD from 2025-01-01 through 2025-12-31.",
  });
  assert.deepEqual(received?.structured, {
    field: "ARR",
    value: "$2,000,000",
    unit: "currency",
    currency: "USD",
    periodStart: "2025-01-01",
    periodEnd: "2025-12-31",
    publishedAt: null,
    eventAt: null,
  });
});

test("memory confirmation remains one atomic idempotent receipt across service instances", async () => {
  const uploads = await awaitingUpload();
  const sources = createMemorySourceRegistry();
  const deals = createMemoryDealRegistry({ sourceRegistry: sources });
  const firstService = createUploadConfirmationService({
    uploads,
    sources,
    deals,
    now: () => new Date("2026-07-29T12:05:00.000Z"),
  });
  const secondService = createUploadConfirmationService({
    uploads,
    sources,
    deals,
    now: () => new Date("2026-07-29T12:06:00.000Z"),
  });
  const input = {
    workspaceId: "workspace_1",
    uploadId: "upload_1",
    assignedByUserId: "user_1",
    choice: {
      companyName: "Acme",
      assignment: {
        kind: "new_deal" as const,
        dealStatus: "evaluating" as const,
      },
    },
  };

  const [first, second] = await Promise.all([
    firstService.confirm(input),
    secondService.confirm(input),
  ]);
  assert.deepEqual(second, first);
  assert.equal(sources.inspect().revisions.length, 1);
  assert.equal(deals.inspect().assignments.length, 1);
});

test("distinct upload wrappers share one same-upload confirmation receipt", async () => {
  const uploads = await awaitingUpload();
  const firstWrapper = { ...uploads };
  const secondWrapper = { ...uploads };
  assert.notEqual(firstWrapper, secondWrapper);
  const sources = createMemorySourceRegistry();
  const deals = createMemoryDealRegistry({ sourceRegistry: sources });
  const firstService = createUploadConfirmationService({
    uploads: firstWrapper,
    sources,
    deals,
    now: () => new Date("2026-07-29T12:05:00.000Z"),
  });
  const secondService = createUploadConfirmationService({
    uploads: secondWrapper,
    sources,
    deals,
    now: () => new Date("2026-07-29T12:06:00.000Z"),
  });
  const input = {
    workspaceId: "workspace_1",
    uploadId: "upload_1",
    assignedByUserId: "user_1",
    choice: {
      companyName: "Acme",
      assignment: {
        kind: "new_deal" as const,
        dealStatus: "evaluating" as const,
      },
    },
  };

  const [first, second] = await Promise.all([
    firstService.confirm(input),
    secondService.confirm(input),
  ]);

  assert.deepEqual(second, first);
  assert.equal(sources.inspect().revisions.length, 1);
  assert.equal(deals.inspect().assignments.length, 1);
});

for (
  const [label, unrelatedWorkspaceId] of [
    ["another workspace", "workspace_2"],
    ["the same workspace", "workspace_1"],
  ] as const
) {
  test(`failed memory promotion preserves unrelated writes in ${label}`, async () => {
    const uploads = await awaitingUpload();
    const sources = createMemorySourceRegistry();
    const deals = createMemoryDealRegistry({ sourceRegistry: sources });
    let reachedUploadMutation!: () => void;
    const uploadMutationReached = new Promise<void>((resolve) => {
      reachedUploadMutation = resolve;
    });
    let releaseUploadMutation!: () => void;
    const uploadMutationReleased = new Promise<void>((resolve) => {
      releaseUploadMutation = resolve;
    });
    const failingService = createUploadConfirmationService({
      uploads: {
        ...uploads,
        async markConfirmed() {
          reachedUploadMutation();
          await uploadMutationReleased;
          throw new Error("injected paused upload transition failure");
        },
      },
      sources,
      deals,
    });
    const failingConfirmation = failingService.confirm({
      workspaceId: "workspace_1",
      uploadId: "upload_1",
      assignedByUserId: "user_1",
      choice: {
        companyName: "Acme",
        assignment: { kind: "new_deal", dealStatus: "evaluating" },
      },
    });
    await Promise.race([
      uploadMutationReached,
      failingConfirmation.then(
        () => {
          throw new Error("The failing promotion unexpectedly succeeded.");
        },
        (error: unknown) => {
          throw error;
        },
      ),
    ]);

    await uploads.create({
      id: "upload_unrelated",
      workspaceId: unrelatedWorkspaceId,
      filename: "unrelated.txt",
      contentType: "text/plain",
      byteSize: 9,
      checksum: `unrelated-${unrelatedWorkspaceId}`,
      objectKey: `private/${unrelatedWorkspaceId}/unrelated.txt`,
    });
    await sources.createInitialRevision({
      id: "revision_unrelated",
      workspaceId: unrelatedWorkspaceId,
      sourceId: "source_unrelated",
      contentHash: `hash-${unrelatedWorkspaceId}`,
      objectKey: `private/${unrelatedWorkspaceId}/source.txt`,
      objectVersion: `hash-${unrelatedWorkspaceId}`,
      contentType: "text/plain",
      extractorId: "plain_text_v1",
      extractorVersion: "1",
      extractedAt: "2026-07-29T12:00:00.000Z",
      createdAt: "2026-07-29T12:00:00.000Z",
    });
    await deals.confirmSourceAssignment({
      requestId: "request_unrelated",
      workspaceId: unrelatedWorkspaceId,
      dealId: "deal_unrelated",
      companyId: "company_unrelated",
      companyName: "Unrelated",
      status: "watchlist",
      sourceRevisionId: "revision_unrelated",
      assignedByUserId: "user_unrelated",
      reason: "Concurrent unrelated write.",
      confirmedAt: "2026-07-29T12:00:01.000Z",
    });

    releaseUploadMutation();
    await assert.rejects(
      failingConfirmation,
      /injected paused upload transition failure/,
    );
    assert.ok(await uploads.get({
      workspaceId: unrelatedWorkspaceId,
      id: "upload_unrelated",
    }));
    assert.ok(await sources.getRevision({
      workspaceId: unrelatedWorkspaceId,
      revisionId: "revision_unrelated",
    }));
    assert.ok(await deals.findForWorkspace({
      workspaceId: unrelatedWorkspaceId,
      dealId: "deal_unrelated",
    }));
    assert.equal(
      sources.inspect().revisions.some((revision) =>
        revision.id === "revision_unrelated"
        && revision.workspaceId === unrelatedWorkspaceId
      ),
      true,
    );
    assert.equal(
      deals.inspect().assignments.some((assignment) =>
        assignment.dealId === "deal_unrelated"
        && assignment.workspaceId === unrelatedWorkspaceId
      ),
      true,
    );
  });
}

test("failed promotion cannot erase a concurrent upload targeting the same Deal", async () => {
  const uploads = await awaitingUpload();
  await uploads.create({
    id: "upload_2",
    workspaceId: "workspace_1",
    filename: "second.txt",
    contentType: "text/plain",
    byteSize: 30,
    checksum: "content-hash-two",
    objectKey: "private/workspaces/workspace_1/uploads/upload_2/second.txt",
  });
  const secondClaim = await uploads.claimNext("extractor-b");
  assert.ok(secondClaim);
  assert.equal(secondClaim.id, "upload_2");
  assert.equal(await uploads.savePreview({
    workspaceId: secondClaim.workspaceId,
    id: secondClaim.id,
    workerId: secondClaim.workerId,
    leaseToken: secondClaim.leaseToken,
    preview: {
      ...preview,
      extractionMetadata: {
        ...preview.extractionMetadata,
        contentHash: "content-hash-two",
      },
    },
  }), true);
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
  let reachedUploadMutation!: () => void;
  const uploadMutationReached = new Promise<void>((resolve) => {
    reachedUploadMutation = resolve;
  });
  let releaseUploadMutation!: () => void;
  const uploadMutationReleased = new Promise<void>((resolve) => {
    releaseUploadMutation = resolve;
  });
  const failingService = createUploadConfirmationService({
    uploads: {
      ...uploads,
      async markConfirmed() {
        reachedUploadMutation();
        await uploadMutationReleased;
        throw new Error("injected same-Deal upload transition failure");
      },
    },
    sources,
    deals,
  });
  const successfulService = createUploadConfirmationService({
    uploads,
    sources,
    deals,
  });
  const existingDealChoice = {
    companyName: "Existing Co",
    assignment: {
      kind: "existing_deal" as const,
      dealId: "deal_existing",
    },
  };
  const failingConfirmation = failingService.confirm({
    workspaceId: "workspace_1",
    uploadId: "upload_1",
    assignedByUserId: "user_1",
    choice: existingDealChoice,
  });
  await Promise.race([
    uploadMutationReached,
    failingConfirmation.then(
      () => {
        throw new Error("The failing promotion unexpectedly succeeded.");
      },
      (error: unknown) => {
        throw error;
      },
    ),
  ]);
  const successfulConfirmation = successfulService.confirm({
    workspaceId: "workspace_1",
    uploadId: "upload_2",
    assignedByUserId: "user_2",
    choice: existingDealChoice,
  });
  await Promise.race([
    successfulConfirmation.then(() => undefined),
    new Promise<void>((resolve) => setImmediate(resolve)),
  ]);
  releaseUploadMutation();

  await assert.rejects(
    failingConfirmation,
    /injected same-Deal upload transition failure/,
  );
  const successful = await successfulConfirmation;
  assert.equal((await uploads.get({
    workspaceId: "workspace_1",
    id: "upload_1",
  }))?.status, "awaiting_confirmation");
  assert.equal((await uploads.get({
    workspaceId: "workspace_1",
    id: "upload_2",
  }))?.status, "confirmed");
  assert.equal(
    (await sources.getRevision({
      workspaceId: "workspace_1",
      revisionId: successful.sourceRevisionId,
    }))?.contentHash,
    "content-hash-two",
  );
  assert.equal(sources.inspect().revisions.length, 2);
  assert.equal(deals.inspect().assignments.length, 2);
  assert.deepEqual(
    (await deals.findForWorkspace({
      workspaceId: "workspace_1",
      dealId: "deal_existing",
    }))?.activeSourceRevisionIds,
    ["revision_seed", successful.sourceRevisionId].sort(),
  );
});

test("failed promotion serializes an ordinary same-Deal assignment before rollback", async () => {
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
  let reachedUploadMutation!: () => void;
  const uploadMutationReached = new Promise<void>((resolve) => {
    reachedUploadMutation = resolve;
  });
  let releaseUploadMutation!: () => void;
  const uploadMutationReleased = new Promise<void>((resolve) => {
    releaseUploadMutation = resolve;
  });
  const failingService = createUploadConfirmationService({
    uploads: {
      ...uploads,
      async markConfirmed() {
        reachedUploadMutation();
        await uploadMutationReleased;
        throw new Error("injected ordinary same-Deal transition failure");
      },
    },
    sources,
    deals,
    now: () => new Date("2026-07-29T12:05:00.000Z"),
  });
  const failingConfirmation = failingService.confirm({
    workspaceId: "workspace_1",
    uploadId: "upload_1",
    assignedByUserId: "user_1",
    choice: {
      companyName: "Existing Co",
      assignment: {
        kind: "existing_deal",
        dealId: "deal_existing",
      },
    },
  });
  await Promise.race([
    uploadMutationReached,
    failingConfirmation.then(
      () => {
        throw new Error("The failing promotion unexpectedly succeeded.");
      },
      (error: unknown) => {
        throw error;
      },
    ),
  ]);
  const failedRevision = sources.inspect().revisions.find((revision) =>
    revision.id !== "revision_seed"
  );
  assert.ok(failedRevision);
  await sources.createInitialRevision({
    id: "revision_live",
    workspaceId: "workspace_1",
    sourceId: "source_live",
    contentHash: "live-hash",
    objectKey: "private/live.txt",
    objectVersion: "live-hash",
    contentType: "text/plain",
    extractorId: "plain_text_v1",
    extractorVersion: "1",
    extractedAt: "2026-07-29T12:06:00.000Z",
    createdAt: "2026-07-29T12:06:00.000Z",
  });
  let ordinaryAssignmentSettled = false;
  const ordinaryAssignment = deals.confirmSourceAssignment({
    requestId: "request_live",
    workspaceId: "workspace_1",
    dealId: "deal_existing",
    companyId: "company_existing",
    companyName: "Existing Co",
    status: "watchlist",
    sourceRevisionId: "revision_live",
    assignedByUserId: "user_live",
    reason: "Concurrent ordinary assignment.",
    confirmedAt: "2026-07-29T12:06:01.000Z",
  });
  void ordinaryAssignment.then(
    () => {
      ordinaryAssignmentSettled = true;
    },
    () => {
      ordinaryAssignmentSettled = true;
    },
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  const assignmentSettledBeforeRollback = ordinaryAssignmentSettled;
  releaseUploadMutation();

  await Promise.race([
    Promise.allSettled([failingConfirmation, ordinaryAssignment]),
    new Promise<never>((_resolve, reject) => {
      setTimeout(
        () => reject(new Error("ordinary same-Deal assignment deadlocked")),
        1_000,
      );
    }),
  ]);
  assert.equal(assignmentSettledBeforeRollback, false);
  await assert.rejects(
    failingConfirmation,
    /injected ordinary same-Deal transition failure/,
  );
  await ordinaryAssignment;

  const liveRevisionIds = ["revision_live", "revision_seed"].sort();
  const finalDeal = await deals.findForWorkspace({
    workspaceId: "workspace_1",
    dealId: "deal_existing",
  });
  assert.ok(finalDeal);
  assert.deepEqual(finalDeal.activeSourceRevisionIds, liveRevisionIds);
  assert.equal(
    finalDeal.activeSourceRevisionFingerprint,
    sourceRevisionFingerprint(liveRevisionIds),
  );
  assert.deepEqual(
    sources.inspect().revisions.map((revision) => revision.id).sort(),
    liveRevisionIds,
  );
  assert.equal(
    sources.inspect().revisions.some((revision) =>
      revision.id === failedRevision.id
    ),
    false,
  );
  const finalAssignments = deals.inspect().assignments;
  assert.deepEqual(
    finalAssignments.map((assignment) => assignment.sourceRevisionId).sort(),
    liveRevisionIds,
  );
  assert.equal(
    finalAssignments.some((assignment) =>
      assignment.sourceRevisionId === failedRevision.id
    ),
    false,
  );
  const existingRevisionIds = new Set(
    sources.inspect().revisions.map((revision) => revision.id),
  );
  assert.equal(
    finalAssignments.every((assignment) =>
      existingRevisionIds.has(assignment.sourceRevisionId)
    ),
    true,
  );
});

test("failed promotion cannot orphan a concurrent exact-source append", async () => {
  const uploads = await awaitingUpload();
  const sources = createMemorySourceRegistry();
  const deals = createMemoryDealRegistry({ sourceRegistry: sources });
  let reachedUploadMutation!: () => void;
  const uploadMutationReached = new Promise<void>((resolve) => {
    reachedUploadMutation = resolve;
  });
  let releaseUploadMutation!: () => void;
  const uploadMutationReleased = new Promise<void>((resolve) => {
    releaseUploadMutation = resolve;
  });
  const failingService = createUploadConfirmationService({
    uploads: {
      ...uploads,
      async markConfirmed() {
        reachedUploadMutation();
        await uploadMutationReleased;
        throw new Error("injected source-history transition failure");
      },
    },
    sources,
    deals,
  });
  const failingConfirmation = failingService.confirm({
    workspaceId: "workspace_1",
    uploadId: "upload_1",
    assignedByUserId: "user_1",
    choice: {
      companyName: "Acme",
      assignment: { kind: "new_deal", dealStatus: "evaluating" },
    },
  });
  await Promise.race([
    uploadMutationReached,
    failingConfirmation.then(
      () => {
        throw new Error("The failing promotion unexpectedly succeeded.");
      },
      (error: unknown) => {
        throw error;
      },
    ),
  ]);
  const initial = sources.inspect().revisions[0];
  assert.ok(initial);
  let appendSettled = false;
  const append = sources.appendRevision({
    id: "revision_concurrent_append",
    workspaceId: initial.workspaceId,
    sourceId: initial.sourceId,
    contentHash: "concurrent-hash",
    objectKey: "private/concurrent-append.txt",
    objectVersion: "concurrent-hash",
    contentType: "text/plain",
    extractorId: "plain_text_v1",
    extractorVersion: "1",
    extractedAt: "2026-07-29T12:06:00.000Z",
    supersedesRevisionId: initial.id,
    createdAt: "2026-07-29T12:06:00.000Z",
  });
  void append.then(
    () => {
      appendSettled = true;
    },
    () => {
      appendSettled = true;
    },
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  const appendSettledBeforeRollback = appendSettled;
  releaseUploadMutation();

  await Promise.race([
    Promise.allSettled([failingConfirmation, append]),
    new Promise<never>((_resolve, reject) => {
      setTimeout(() => reject(new Error("source promotion deadlocked")), 1_000);
    }),
  ]);
  assert.equal(appendSettledBeforeRollback, false);
  await assert.rejects(
    failingConfirmation,
    /injected source-history transition failure/,
  );
  await assert.rejects(append, /initial source revision is required/i);
  assert.equal(sources.inspect().revisions.length, 0);
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

test("the memory Deal registry retains facts by exact source revision", async () => {
  const sources = createMemorySourceRegistry();
  const deals = createMemoryDealRegistry({ sourceRegistry: sources });
  await sources.createInitialRevision({
    id: "revision_1",
    workspaceId: "workspace_1",
    sourceId: "source_shared",
    contentHash: "hash-1",
    objectKey: "private/source-v1.txt",
    objectVersion: "hash-1",
    contentType: "text/plain",
    extractorId: "plain_text_v1",
    extractorVersion: "1",
    extractedAt: "2026-07-29T10:00:00.000Z",
    createdAt: "2026-07-29T10:00:00.000Z",
  });
  await deals.confirmSourceAssignment(exactBundleAssignment({
    revisionId: "revision_1",
    fact: "Fact from revision one.",
  }));
  await sources.appendRevision({
    id: "revision_2",
    workspaceId: "workspace_1",
    sourceId: "source_shared",
    contentHash: "hash-2",
    objectKey: "private/source-v2.txt",
    objectVersion: "hash-2",
    contentType: "text/plain",
    extractorId: "plain_text_v1",
    extractorVersion: "1",
    extractedAt: "2026-07-29T11:00:00.000Z",
    supersedesRevisionId: "revision_1",
    createdAt: "2026-07-29T11:00:00.000Z",
  });
  await deals.confirmSourceAssignment(exactBundleAssignment({
    revisionId: "revision_2",
    fact: "Fact from revision two.",
  }));
  const exactReader = (
    deals as typeof deals & {
      getExactSourceBundle(input: {
        workspaceId: string;
        dealId: string;
        sourceId: string;
        sourceRevisionId: string;
      }): Promise<{ bundle: { facts: Array<{ text: string }> } } | null>;
    }
  ).getExactSourceBundle;

  assert.equal(typeof exactReader, "function");
  assert.deepEqual(
    (await exactReader.call(deals, {
      workspaceId: "workspace_1",
      dealId: "deal_shared",
      sourceId: "source_shared",
      sourceRevisionId: "revision_1",
    }))?.bundle.facts.map((fact) => fact.text),
    ["Fact from revision one."],
  );
  assert.deepEqual(
    (await exactReader.call(deals, {
      workspaceId: "workspace_1",
      dealId: "deal_shared",
      sourceId: "source_shared",
      sourceRevisionId: "revision_2",
    }))?.bundle.facts.map((fact) => fact.text),
    ["Fact from revision two."],
  );
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

test("memory confirmation rolls back revision and Deal assignment when the upload transition fails", async () => {
  const uploads = await awaitingUpload();
  const sources = createMemorySourceRegistry();
  const deals = createMemoryDealRegistry({ sourceRegistry: sources });
  const service = createUploadConfirmationService({
    uploads: {
      ...uploads,
      async markConfirmed() {
        throw new Error("injected upload transition failure");
      },
    },
    sources,
    deals,
  });

  await assert.rejects(service.confirm({
    workspaceId: "workspace_1",
    uploadId: "upload_1",
    assignedByUserId: "user_1",
    choice: {
      companyName: "Acme",
      assignment: { kind: "new_deal", dealStatus: "evaluating" },
    },
  }), /injected upload transition failure/);
  assert.equal(sources.inspect().revisions.length, 0);
  assert.equal(deals.inspect().assignments.length, 0);
  assert.equal((await uploads.get({
    workspaceId: "workspace_1",
    id: "upload_1",
  }))?.status, "awaiting_confirmation");
});

test("memory confirmation rolls back the revision when Deal confirmation fails", async () => {
  const uploads = await awaitingUpload();
  const sources = createMemorySourceRegistry();
  const deals = createMemoryDealRegistry({ sourceRegistry: sources });
  const failingDeals: typeof deals = {
    ...deals,
    withPromotionLock(scope, operation) {
      return deals.withPromotionLock(scope, () =>
        operation(async () => {
          throw new Error("injected Deal confirmation failure");
        })
      );
    },
  };
  const service = createUploadConfirmationService({
    uploads,
    sources,
    deals: failingDeals,
  });

  await assert.rejects(service.confirm({
    workspaceId: "workspace_1",
    uploadId: "upload_1",
    assignedByUserId: "user_1",
    choice: {
      companyName: "Acme",
      assignment: { kind: "new_deal", dealStatus: "evaluating" },
    },
  }), /injected Deal confirmation failure/);
  assert.equal(sources.inspect().revisions.length, 0);
  assert.equal(deals.inspect().assignments.length, 0);
  assert.equal((await uploads.get({
    workspaceId: "workspace_1",
    id: "upload_1",
  }))?.status, "awaiting_confirmation");

  const retryService = createUploadConfirmationService({
    uploads,
    sources,
    deals,
  });
  const retryInput = {
    workspaceId: "workspace_1",
    uploadId: "upload_1",
    assignedByUserId: "user_1",
    choice: {
      companyName: "Acme",
      assignment: {
        kind: "new_deal" as const,
        dealStatus: "evaluating" as const,
      },
    },
  };
  const firstRetry = await retryService.confirm(retryInput);
  assert.deepEqual(await retryService.confirm(retryInput), firstRetry);
  assert.equal(sources.inspect().revisions.length, 1);
  assert.equal(deals.inspect().assignments.length, 1);
});

function exactBundleAssignment(input: {
  revisionId: string;
  fact: string;
}) {
  const evidenceId = `evidence_${input.revisionId}`;
  return {
    requestId: `request_${input.revisionId}`,
    workspaceId: "workspace_1",
    dealId: "deal_shared",
    companyId: "company_shared",
    companyName: "Shared",
    status: "evaluating" as const,
    sourceRevisionId: input.revisionId,
    assignedByUserId: "user_1",
    reason: "Exact revision test",
    confirmedAt: "2026-07-29T12:00:00.000Z",
    memoryBundle: {
      dealId: "deal_shared",
      companyName: "Shared",
      status: "evaluating" as const,
      facts: [{
        text: input.fact,
        sources: [{
          id: evidenceId,
          documentId: "source_shared",
          provenance: "source_document" as const,
          title: "shared.txt",
          page: 1,
          excerpt: input.fact,
        }],
      }],
      interactions: [],
    },
    memoryLineage: {
      evidence: {
        [evidenceId]: {
          workspaceId: "workspace_1",
          dealId: "deal_shared",
          sourceId: "source_shared",
          sourceRevisionId: input.revisionId,
        },
      },
      interactions: {},
    },
  };
}

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

test("an expired extraction owner cannot renew, complete, or fail before reclaim", async () => {
  const mutations = [
    {
      name: "renew",
      run: (
        uploads: ReturnType<typeof createMemoryUploadedDocumentsRepository>,
        claim: NonNullable<Awaited<ReturnType<typeof uploads.claimNext>>>,
      ) => uploads.renewLease({
        workspaceId: claim.workspaceId,
        id: claim.id,
        workerId: claim.workerId,
        leaseToken: claim.leaseToken,
      }),
    },
    {
      name: "complete",
      run: (
        uploads: ReturnType<typeof createMemoryUploadedDocumentsRepository>,
        claim: NonNullable<Awaited<ReturnType<typeof uploads.claimNext>>>,
      ) => uploads.savePreview({
        workspaceId: claim.workspaceId,
        id: claim.id,
        workerId: claim.workerId,
        leaseToken: claim.leaseToken,
        preview,
      }),
    },
    {
      name: "fail",
      run: (
        uploads: ReturnType<typeof createMemoryUploadedDocumentsRepository>,
        claim: NonNullable<Awaited<ReturnType<typeof uploads.claimNext>>>,
      ) => uploads.fail({
        workspaceId: claim.workspaceId,
        id: claim.id,
        workerId: claim.workerId,
        leaseToken: claim.leaseToken,
        reason: "expired",
      }),
    },
  ];
  for (const mutation of mutations) {
    let now = new Date("2026-07-29T12:00:00.000Z");
    const uploads = createMemoryUploadedDocumentsRepository({ now: () => now });
    await uploads.create({
      id: `upload_expired_extraction_${mutation.name}`,
      workspaceId: "workspace_1",
      filename: `${mutation.name}.txt`,
      contentType: "text/plain",
      byteSize: 5,
      checksum: `hash-${mutation.name}`,
      objectKey: `private/${mutation.name}.txt`,
    });
    const claim = await uploads.claimNext("worker-a");
    assert.ok(claim);
    now = new Date("2026-07-29T12:05:01.000Z");

    assert.equal(await mutation.run(uploads, claim), false, mutation.name);
    const reclaimed = await uploads.claimNext("worker-b");
    assert.ok(reclaimed, mutation.name);
    assert.notEqual(reclaimed.leaseToken, claim.leaseToken, mutation.name);
  }
});

test("an expired confirmed-ingest owner cannot renew, complete, or fail before reclaim", async () => {
  const mutations = [
    {
      name: "renew",
      run: (
        uploads: ReturnType<typeof createMemoryUploadedDocumentsRepository>,
        claim: NonNullable<
          Awaited<ReturnType<typeof uploads.claimNextConfirmed>>
        >,
      ) => uploads.renewLease({
        workspaceId: claim.workspaceId,
        id: claim.id,
        workerId: claim.workerId,
        leaseToken: claim.leaseToken,
      }),
    },
    {
      name: "complete",
      run: (
        uploads: ReturnType<typeof createMemoryUploadedDocumentsRepository>,
        claim: NonNullable<
          Awaited<ReturnType<typeof uploads.claimNextConfirmed>>
        >,
      ) => uploads.completeConfirmed({
        workspaceId: claim.workspaceId,
        id: claim.id,
        workerId: claim.workerId,
        leaseToken: claim.leaseToken,
      }),
    },
    {
      name: "fail",
      run: (
        uploads: ReturnType<typeof createMemoryUploadedDocumentsRepository>,
        claim: NonNullable<
          Awaited<ReturnType<typeof uploads.claimNextConfirmed>>
        >,
      ) => uploads.failConfirmed({
        workspaceId: claim.workspaceId,
        id: claim.id,
        workerId: claim.workerId,
        leaseToken: claim.leaseToken,
        reason: "expired",
      }),
    },
  ];
  for (const mutation of mutations) {
    let now = new Date("2026-07-29T12:00:00.000Z");
    const uploads = createMemoryUploadedDocumentsRepository({ now: () => now });
    const id = `upload_expired_confirmed_${mutation.name}`;
    await uploads.create({
      id,
      workspaceId: "workspace_1",
      filename: `${mutation.name}.txt`,
      contentType: "text/plain",
      byteSize: 5,
      checksum: `confirmed-hash-${mutation.name}`,
      objectKey: `private/confirmed-${mutation.name}.txt`,
    });
    const extraction = await uploads.claimNext("extractor");
    assert.ok(extraction);
    assert.equal(await uploads.savePreview({
      workspaceId: extraction.workspaceId,
      id,
      workerId: extraction.workerId,
      leaseToken: extraction.leaseToken,
      preview,
    }), true);
    await uploads.markConfirmed({
      workspaceId: "workspace_1",
      id,
      confirmationFingerprint: `confirmed-${mutation.name}`,
      dealId: "deal_1",
      sourceId: "source_1",
      sourceRevisionId: "revision_1",
    });
    const claim = await uploads.claimNextConfirmed("worker-a");
    assert.ok(claim);
    now = new Date("2026-07-29T12:05:01.000Z");

    assert.equal(await mutation.run(uploads, claim), false, mutation.name);
    const reclaimed = await uploads.claimNextConfirmed("worker-b");
    assert.ok(reclaimed, mutation.name);
    assert.notEqual(reclaimed.leaseToken, claim.leaseToken, mutation.name);
  }
});
