import type { UploadedDocumentsRepository } from "../../db/repositories/uploaded-documents";
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
  documentAccess?: PrivateDocumentAccess;
  privateObjectStorage?: PrivateObjectStorage;
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
