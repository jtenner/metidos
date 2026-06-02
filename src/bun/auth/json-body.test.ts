/**
 * @file src/bun/auth/json-body.test.ts
 * @description Tests for auth JSON request body parsing and error mapping.
 */

import { describe, expect, it } from "bun:test";

import { LimitedBodyError } from "../limited-json-response";
import { RequestValidationError } from "./http-security";
import {
  parseJsonObjectBody,
  toJsonRequestBodyLimitValidationError,
} from "./json-body";

describe("auth JSON body helpers", () => {
  it("treats empty and whitespace-only bodies as empty objects", () => {
    expect(parseJsonObjectBody("")).toEqual({});
    expect(parseJsonObjectBody(" \n\t ")).toEqual({});
  });

  it("accepts JSON objects only", () => {
    expect(
      parseJsonObjectBody('{"username":"operator","remember":true}'),
    ).toEqual({
      remember: true,
      username: "operator",
    });
  });

  it("rejects non-object JSON request bodies", () => {
    for (const rawBody of ["[]", "null", '"string"', "42", "true"]) {
      expect(() => parseJsonObjectBody(rawBody)).toThrow(
        RequestValidationError,
      );
      try {
        parseJsonObjectBody(rawBody);
        throw new Error("Expected non-object JSON to be rejected.");
      } catch (error) {
        expect(error).toBeInstanceOf(RequestValidationError);
        expect((error as RequestValidationError).code).toBe("invalid_request");
        expect((error as RequestValidationError).status).toBe(400);
      }
    }
  });

  it("maps malformed JSON to a validation error instead of leaking raw parser errors", () => {
    try {
      parseJsonObjectBody('{"unterminated"');
      throw new Error("Expected malformed JSON to be rejected.");
    } catch (error) {
      expect(error).toBeInstanceOf(RequestValidationError);
      expect((error as RequestValidationError).code).toBe("invalid_request");
      expect((error as RequestValidationError).status).toBe(400);
    }
  });

  it("maps oversized bounded-body errors to stable request validation metadata", () => {
    const mapped = toJsonRequestBodyLimitValidationError(
      new LimitedBodyError("JSON request body is too large.", "body_too_large"),
    );

    expect(mapped).toBeInstanceOf(RequestValidationError);
    expect(mapped?.message).toBe("JSON request body is too large.");
    expect(mapped?.code).toBe("request_body_too_large");
    expect(mapped?.status).toBe(413);
  });

  it("ignores unrelated bounded-body errors", () => {
    expect(
      toJsonRequestBodyLimitValidationError(new Error("other")),
    ).toBeNull();
  });
});
