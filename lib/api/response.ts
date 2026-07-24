import { ZodError } from "zod";

export function jsonOk<T>(data: T, init: ResponseInit = {}) {
  return Response.json({ data }, { status: 200, ...init });
}

export function jsonCreated<T>(data: T) {
  return Response.json({ data }, { status: 201 });
}

export function jsonError(
  code: "VALIDATION_ERROR" | "NOT_FOUND" | "CONFLICT" | "RATE_LIMITED" | "INTEGRATION_UNAVAILABLE",
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
  const message = error instanceof Error ? error.message : "Unexpected error";
  return jsonError("INTEGRATION_UNAVAILABLE", message, 503, true);
}
