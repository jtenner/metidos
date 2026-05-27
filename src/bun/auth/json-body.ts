import { LimitedBodyError } from "../limited-json-response";
import { RequestValidationError } from "./http-security";

export function toJsonRequestBodyLimitValidationError(
  error: unknown,
): RequestValidationError | null {
  if (error instanceof LimitedBodyError && error.code === "body_too_large") {
    return new RequestValidationError("JSON request body is too large.", {
      code: "request_body_too_large",
      status: 413,
    });
  }
  return null;
}

export function parseJsonObjectBody(rawBody: string): Record<string, unknown> {
  if (!rawBody.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(rawBody) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw new RequestValidationError("JSON request bodies must be objects.");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof RequestValidationError) {
      throw error;
    }
    throw new RequestValidationError(
      error instanceof Error ? error.message : "Invalid JSON request body.",
    );
  }
}
