import { ZodError } from "zod";
import type { ApiErrorCode } from "../contracts/http";
import { IntegrationTransportError } from "./errors";

export function jsonOk<T>(data: T, init: ResponseInit = {}) {
  return Response.json({ data }, { status: 200, ...init });
}

export function jsonCreated<T>(data: T) {
  return Response.json({ data }, { status: 201 });
}

export function jsonError(
  code: ApiErrorCode,
  message: string,
  status: number,
  retryable = false,
) {
  return Response.json({ error: { code, message, retryable } }, { status });
}

export function errorResponse(error: unknown) {
  if (error instanceof ZodError) {
    return jsonError("VALIDATION_ERROR", error.issues[0]?.message ?? "Invalid request", 400);
  }
  if (error instanceof Error && error.message === "UNAUTHENTICATED") {
    return jsonError("UNAUTHENTICATED", "Authentication required", 401);
  }
  if (error instanceof Error && error.message === "FORBIDDEN") {
    return jsonError("FORBIDDEN", "Access denied", 403);
  }
  if (error instanceof IntegrationTransportError && error.retryable) {
    console.error("Unavailable API integration", error);
    return jsonError("INTEGRATION_UNAVAILABLE", "A required service is unavailable", 503, true);
  }
  console.error("Unhandled API error", error);
  return jsonError("INTERNAL_ERROR", "Internal server error", 500);
}
