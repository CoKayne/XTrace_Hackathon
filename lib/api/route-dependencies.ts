import type { UploadedDocumentsRepository } from "../../db/repositories/uploaded-documents";
import type { SourceRegistry } from "../../db/repositories/source-registry";
import type { DealRegistry } from "../../db/repositories/deal-registry";
import type {
  UnderwritingReferencesRepository,
} from "../../db/repositories/underwriting-references";
import {
  resolveRequestContext,
  type AuthorizedRequestContext,
} from "../auth/request-context";
import type {
  PrivateDocumentAccess,
  PrivateObjectStorage,
} from "../storage/service";

export interface RouteDependencies {
  resolveRequestContext?: (
    request: Request,
  ) => Promise<AuthorizedRequestContext>;
  uploadedDocuments?: UploadedDocumentsRepository;
  sourceRegistry?: SourceRegistry;
  dealRegistry?: DealRegistry;
  documentAccess?: PrivateDocumentAccess;
  privateObjectStorage?: PrivateObjectStorage;
  underwritingReferences?: UnderwritingReferencesRepository;
  now?: () => number;
}

export function resolveRouteRequestContext(
  request: Request,
  dependencies: RouteDependencies,
): Promise<AuthorizedRequestContext> {
  return (
    dependencies.resolveRequestContext ?? resolveRequestContext
  )(request);
}
