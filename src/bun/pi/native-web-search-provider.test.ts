import { describe, expect, it } from "bun:test";

import {
  extractOpenRouterMessageImages,
  normalizeOpenAIResponseFunctionCallNames,
} from "./native-web-search-provider";

const ONE_PIXEL_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

const ONE_PIXEL_PNG_BYTES = Uint8Array.from(
  Buffer.from(ONE_PIXEL_PNG, "base64"),
);

function createSafeFetchMock(
  handler: (url: string) => Response | Promise<Response>,
): {
  fetch: (url: URL) => Promise<Response>;
  urls: string[];
} {
  const urls: string[] = [];
  return {
    fetch: async (url) => {
      urls.push(url.toString());
      return handler(url.toString());
    },
    urls,
  };
}

describe("normalizeOpenAIResponseFunctionCallNames", () => {
  it("normalizes historical foreign tool call names for Codex Responses input", () => {
    expect(
      normalizeOpenAIResponseFunctionCallNames([
        { type: "message", name: "unchanged.message" },
        {
          type: "function_call",
          call_id: "call_1",
          name: "functions.read",
          arguments: "{}",
        },
        {
          type: "function_call",
          call_id: "call_2",
          name: "already_valid-name",
          arguments: "{}",
        },
      ]),
    ).toEqual([
      { type: "message", name: "unchanged.message" },
      {
        type: "function_call",
        call_id: "call_1",
        name: "functions_read",
        arguments: "{}",
      },
      {
        type: "function_call",
        call_id: "call_2",
        name: "already_valid-name",
        arguments: "{}",
      },
    ]);
  });
});

describe("extractOpenRouterMessageImages", () => {
  it("extracts OpenRouter snake_case image data URLs", async () => {
    await expect(
      extractOpenRouterMessageImages({
        images: [
          {
            image_url: { url: `data:image/png;base64,${ONE_PIXEL_PNG}` },
          },
        ],
      }),
    ).resolves.toEqual([
      { data: ONE_PIXEL_PNG, mimeType: "image/png", type: "image" },
    ]);
  });

  it("extracts OpenRouter SDK camelCase image data URLs", async () => {
    await expect(
      extractOpenRouterMessageImages({
        images: [
          {
            imageUrl: { url: `data:image/png;base64,${ONE_PIXEL_PNG}` },
          },
        ],
      }),
    ).resolves.toEqual([
      { data: ONE_PIXEL_PNG, mimeType: "image/png", type: "image" },
    ]);
  });

  it("extracts b64_json image payloads", async () => {
    await expect(
      extractOpenRouterMessageImages({
        images: [
          {
            b64_json: ONE_PIXEL_PNG,
            mime_type: "image/png",
          },
        ],
      }),
    ).resolves.toEqual([
      { data: ONE_PIXEL_PNG, mimeType: "image/png", type: "image" },
    ]);
  });

  it("fetches and validates URL image payloads", async () => {
    const safeFetch = createSafeFetchMock((url) => {
      expect(url).toBe("https://example.test/generated.png");
      return new Response(ONE_PIXEL_PNG_BYTES, {
        headers: { "content-type": "image/png" },
        status: 200,
      });
    });

    await expect(
      extractOpenRouterMessageImages(
        {
          images: [{ url: "https://example.test/generated.png" }],
        },
        undefined,
        safeFetch.fetch,
      ),
    ).resolves.toEqual([
      { data: ONE_PIXEL_PNG, mimeType: "image/png", type: "image" },
    ]);
    expect(safeFetch.urls).toEqual(["https://example.test/generated.png"]);
  });

  it("rejects fetched URL payloads with non-image content types", async () => {
    const safeFetch = createSafeFetchMock(() =>
      Response.json(
        { ok: true },
        { headers: { "content-type": "application/json" } },
      ),
    );

    await expect(
      extractOpenRouterMessageImages(
        {
          images: [{ url: "https://example.test/generated.json" }],
        },
        undefined,
        safeFetch.fetch,
      ),
    ).rejects.toThrow(
      "OpenRouter image generation returned an image URL with a non-image content type.",
    );
  });
});
