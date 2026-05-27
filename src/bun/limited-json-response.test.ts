/**
 * @file src/bun/limited-json-response.test.ts
 * @description Tests for bounded JSON response parsing.
 */

import { describe, expect, it } from "bun:test";

import {
  LimitedBodyError,
  parseContentLengthHeader,
  readLimitedJsonResponse,
  readLimitedTextBody,
  readLimitedTextResponse,
} from "./limited-json-response";

describe("limited JSON response reader", () => {
  it("parses content-length only in canonical decimal form", () => {
    expect(parseContentLengthHeader("0")).toBe(0);
    expect(parseContentLengthHeader("42")).toBe(42);
    expect(parseContentLengthHeader("00042")).toBeNull();
    expect(parseContentLengthHeader("42 ")).toBe(42);
  });

  it("parses valid JSON within the configured byte limit", async () => {
    const response = new Response(JSON.stringify({ ok: true }), {
      headers: {
        "content-type": "application/json",
      },
    });

    await expect(
      readLimitedJsonResponse(response, {
        maxBytes: 64,
      }),
    ).resolves.toEqual({ ok: true });
  });

  it("rejects responses with an oversized content-length before reading", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("{}"));
        controller.close();
      },
    });
    const response = new Response(body, {
      headers: {
        "content-length": "65",
      },
    });

    await expect(
      readLimitedJsonResponse(response, {
        label: "Provider model discovery response",
        maxBytes: 64,
      }),
    ).rejects.toThrow("Provider model discovery response is too large.");
  });

  it("reads text responses within the configured byte limit", async () => {
    const response = new Response("plain text");

    await expect(
      readLimitedTextResponse(response, {
        maxBytes: 64,
      }),
    ).resolves.toBe("plain text");
  });

  it("rejects chunked responses that exceed the byte limit while streaming", async () => {
    const encoder = new TextEncoder();
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('{"data":"'));
          controller.enqueue(encoder.encode("x".repeat(65)));
          controller.enqueue(encoder.encode('"}'));
          controller.close();
        },
      }),
    );

    await expect(
      readLimitedJsonResponse(response, {
        label: "Provider model discovery response",
        maxBytes: 64,
      }),
    ).rejects.toThrow("Provider model discovery response is too large.");
  });

  it("rejects oversized request-style bodies while streaming", async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("x".repeat(32)));
        controller.enqueue(encoder.encode("x".repeat(33)));
        controller.close();
      },
    });

    await expect(
      readLimitedTextBody(body, {
        label: "JSON request body",
        maxBytes: 64,
      }),
    ).rejects.toThrow(LimitedBodyError);
  });

  it("sets a stable code on oversized body errors", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("x".repeat(65)));
        controller.close();
      },
    });

    try {
      await readLimitedTextBody(body, {
        label: "Changed diagnostic text",
        maxBytes: 64,
      });
      throw new Error("Expected oversized body to be rejected.");
    } catch (error) {
      expect(error).toBeInstanceOf(LimitedBodyError);
      expect((error as LimitedBodyError).code).toBe("body_too_large");
    }
  });
});
