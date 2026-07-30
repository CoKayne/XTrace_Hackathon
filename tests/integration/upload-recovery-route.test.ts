import assert from "node:assert/strict";
import test from "node:test";

import { GET as listUploads } from "../../app/api/uploads/route";
import { GET as getUpload } from "../../app/api/uploads/[id]/route";
import {
  createMemoryDealRegistry,
} from "../../db/repositories/deal-registry";
import {
  createMemorySourceRegistry,
} from "../../db/repositories/source-registry";
import {
  createMemoryUploadedDocumentsRepository,
  type ExtractionPreview,
} from "../../db/repositories/uploaded-documents";
import type { RouteDependencies } from "../../lib/api/route-dependencies";

const preview: ExtractionPreview = {
  candidateCompanyName: "Recovery Co",
  candidateHeadline: "Recovery Co serves carriers.",
  facts: [{
    text: "Recovery Co serves carriers.",
    excerpt: "Recovery Co serves carriers.",
    locator: { kind: "text_range", start: 0, end: 28 },
  }],
  extractionMetadata: {
    extractorId: "plain_text_v1",
    extractorVersion: "1",
    extractedAt: "2026-07-29T12:00:00.000Z",
    contentHash: "recovery-hash",
    inputBytes: 28,
    extractedCharacters: 28,
    truncated: false,
  },
};

const imagePreview: ExtractionPreview = {
  candidateCompanyName: "Image Recovery Co",
  candidateHeadline: "Image Recovery Co reported $8M ARR.",
  facts: [{
    text: "Image Recovery Co reported $8M ARR.",
    excerpt: null,
    locator: { kind: "image", imageIndex: 0 },
    structured: {
      field: "arr",
      value: "8000000",
      unit: null,
      currency: "USD",
      periodStart: null,
      periodEnd: "2026-06-30",
      publishedAt: null,
      eventAt: null,
    },
  }],
  extractionMetadata: {
    extractorId: "claude_vision_v1",
    extractorVersion: "1",
    extractedAt: "2026-07-29T12:00:00.000Z",
    contentHash: "image-recovery-hash",
    inputBytes: 4096,
    extractedCharacters: 35,
    truncated: false,
  },
};

function dependencies(
  workspaceId: string,
  uploads = createMemoryUploadedDocumentsRepository(),
): RouteDependencies {
  const sources = createMemorySourceRegistry();
  return {
    async resolveRequestContext() {
      return {
        mode: "product",
        principal: { userId: "user_recovery", email: "user@example.test" },
        workspaceId,
        role: "associate",
        permissions: {
          readWorkspace: true,
          readPrivateSources: true,
          mutateSources: false,
          managePolicy: false,
          administerFrameworks: false,
        },
      };
    },
    uploadedDocuments: uploads,
    sourceRegistry: sources,
    dealRegistry: createMemoryDealRegistry({ sourceRegistry: sources }),
  };
}

async function readyUpload() {
  const workspaceId = "workspace_upload_recovery";
  const uploads = createMemoryUploadedDocumentsRepository();
  await uploads.create({
    id: "upload_recovery",
    workspaceId,
    filename: "../../recovery.md",
    contentType: "text/markdown",
    byteSize: 28,
    checksum: "recovery-hash",
    objectKey: "private/workspaces/workspace_upload_recovery/recovery.md",
  });
  const extracting = await uploads.claimNext("extractor");
  assert.ok(extracting);
  assert.equal(await uploads.savePreview({
    workspaceId,
    id: extracting.id,
    workerId: extracting.workerId,
    leaseToken: extracting.leaseToken,
    preview,
  }), true);
  await uploads.markConfirmed({
    workspaceId,
    id: extracting.id,
    confirmationFingerprint: `sha256:${"c".repeat(64)}`,
    dealId: "deal_recovery",
    sourceId: "source_recovery",
    sourceRevisionId: "revision_recovery",
  });
  const ingesting = await uploads.claimNextConfirmed("memory-worker");
  assert.ok(ingesting);
  assert.equal(await uploads.completeConfirmed({
    workspaceId,
    id: ingesting.id,
    workerId: ingesting.workerId,
    leaseToken: ingesting.leaseToken,
  }), true);
  return { workspaceId, uploads };
}

async function readyImageUpload() {
  const workspaceId = "workspace_image_recovery";
  const uploads = createMemoryUploadedDocumentsRepository();
  await uploads.create({
    id: "upload_image_recovery",
    workspaceId,
    filename: "recovery.png",
    contentType: "image/png",
    byteSize: 4096,
    checksum: "image-recovery-hash",
    objectKey: "private/workspaces/workspace_image_recovery/recovery.png",
  });
  const extracting = await uploads.claimNext("extractor");
  assert.ok(extracting);
  assert.equal(await uploads.savePreview({
    workspaceId,
    id: extracting.id,
    workerId: extracting.workerId,
    leaseToken: extracting.leaseToken,
    preview: imagePreview,
  }), true);
  await uploads.markConfirmed({
    workspaceId,
    id: extracting.id,
    confirmationFingerprint: `sha256:${"d".repeat(64)}`,
    dealId: "deal_image_recovery",
    sourceId: "source_image_recovery",
    sourceRevisionId: "revision_image_recovery",
  });
  const ingesting = await uploads.claimNextConfirmed("memory-worker");
  assert.ok(ingesting);
  assert.equal(await uploads.completeConfirmed({
    workspaceId,
    id: ingesting.id,
    workerId: ingesting.workerId,
    leaseToken: ingesting.leaseToken,
  }), true);
  return { workspaceId, uploads };
}

test("upload listing returns safe recovery DTOs with terminal lineage", async () => {
  const fixture = await readyUpload();
  const response = await listUploads(
    new Request("https://vsee.test/api/uploads"),
    undefined,
    dependencies(fixture.workspaceId, fixture.uploads),
  );

  assert.equal(response.status, 200);
  const payload = await response.json() as {
    data: Array<Record<string, unknown>>;
  };
  assert.deepEqual(payload.data, [{
    uploadId: "upload_recovery",
    status: "ready",
    filename: "recovery.md",
    contentType: "text/markdown",
    preview: {
      candidateCompanyName: "Recovery Co",
      candidateHeadline: "Recovery Co serves carriers.",
      facts: preview.facts,
    },
    failure: null,
    memoryNotice: null,
    dealId: "deal_recovery",
    sourceRevisionId: "revision_recovery",
    createdAt: payload.data[0].createdAt,
    updatedAt: payload.data[0].updatedAt,
  }]);
  assert.doesNotMatch(
    JSON.stringify(payload),
    /workspace_upload_recovery|objectKey|checksum|extractor|contentHash/,
  );
});

test("ready image recovery discloses canonical-only evidence after reload", async () => {
  const fixture = await readyImageUpload();
  const response = await listUploads(
    new Request("https://vsee.test/api/uploads"),
    undefined,
    dependencies(fixture.workspaceId, fixture.uploads),
  );
  assert.equal(response.status, 200);
  const payload = await response.json() as {
    data: Array<Record<string, unknown>>;
  };
  assert.equal(
    payload.data[0]?.memoryNotice,
    "Ready for underwriting from canonical image evidence. "
      + "No XTrace memory was created because no exact quotation was available.",
  );
  assert.equal(payload.data[0]?.failure, null);
  assert.equal(payload.data[0]?.status, "ready");
});

test("terminal upload detail preserves deal and source revision recovery ids", async () => {
  const fixture = await readyUpload();
  const response = await getUpload(
    new Request("https://vsee.test/api/uploads/upload_recovery"),
    { params: Promise.resolve({ id: "upload_recovery" }) },
    dependencies(fixture.workspaceId, fixture.uploads),
  );
  assert.equal(response.status, 200);
  const payload = await response.json() as {
    data: Record<string, unknown> & {
      dealId: string | null;
      sourceRevisionId: string | null;
    };
  };
  assert.equal(payload.data.dealId, "deal_recovery");
  assert.equal(payload.data.sourceRevisionId, "revision_recovery");
});

test("upload listing is organization scoped and unavailable to public demo", async () => {
  const fixture = await readyUpload();
  const foreign = await listUploads(
    new Request("https://vsee.test/api/uploads"),
    undefined,
    dependencies("workspace_foreign", fixture.uploads),
  );
  assert.deepEqual(
    (await foreign.json() as { data: unknown[] }).data,
    [],
  );

  const demo = await listUploads(
    new Request("https://vsee.test/api/uploads"),
    undefined,
    {
      async resolveRequestContext() {
        return {
          mode: "public_demo",
          principal: null,
          workspaceId: "workspace_demo",
          role: "demo",
          permissions: {
            readWorkspace: true,
            readPrivateSources: false,
            mutateSources: false,
            managePolicy: false,
            administerFrameworks: false,
          },
        };
      },
      uploadedDocuments: fixture.uploads,
    },
  );
  assert.equal(demo.status, 403);
});
