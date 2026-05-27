import { describe, expect, it } from "bun:test";

import {
  isChatImageByteSizeAllowed,
  MAX_CHAT_IMAGE_BYTES,
  normalizeChatImageMimeType,
  parseChatImageDataUrl,
  validateChatImageData,
} from "./chat-images";

const ONE_PIXEL_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

const ONE_PIXEL_GIF = "R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

const MINIMAL_WEBP_HEADER =
  "UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAQAcJaQAA3AA/vuUAAA=";

const MINIMAL_JPEG_HEADER = "/9j/4AAQSkZJRgABAQAAAQABAAD/2w==";

describe("chat image byte size limits", () => {
  it("accepts the exact shared byte limit and rejects oversized values", () => {
    expect(isChatImageByteSizeAllowed(MAX_CHAT_IMAGE_BYTES)).toBeTrue();
    expect(isChatImageByteSizeAllowed(MAX_CHAT_IMAGE_BYTES + 1)).toBeFalse();
  });
});

describe("parseChatImageDataUrl", () => {
  it("accepts bounded supported image data URLs", () => {
    expect(
      parseChatImageDataUrl(`data:image/png;base64,${ONE_PIXEL_PNG}`),
    ).toEqual({
      byteSize: 68,
      data: ONE_PIXEL_PNG,
      mimeType: "image/png",
      src: `data:image/png;base64,${ONE_PIXEL_PNG}`,
    });
  });

  it("rejects unsafe or unsupported data URLs", () => {
    expect(parseChatImageDataUrl("data:image/svg+xml;base64,PHN2Zz4=")).toEqual(
      {
        error: "Image data does not match a supported image type.",
      },
    );
    expect(parseChatImageDataUrl("javascript:alert(1)")).toEqual({
      error: "Image data URL must use base64 image data.",
    });
  });
});

describe("validateChatImageData", () => {
  it("accepts supported image signatures", () => {
    expect(validateChatImageData(ONE_PIXEL_PNG, "image/png")).toBeNull();
    expect(validateChatImageData(ONE_PIXEL_GIF, "image/gif")).toBeNull();
    expect(validateChatImageData(MINIMAL_WEBP_HEADER, "image/webp")).toBeNull();
    expect(validateChatImageData(MINIMAL_JPEG_HEADER, "image/jpeg")).toBeNull();
  });

  it("normalizes common browser MIME aliases and missing types by signature", () => {
    expect(
      normalizeChatImageMimeType(MINIMAL_JPEG_HEADER, "image/jpg"),
    ).toEqual({
      mimeType: "image/jpeg",
    });
    expect(normalizeChatImageMimeType(ONE_PIXEL_PNG, "")).toEqual({
      mimeType: "image/png",
    });
  });

  it("rejects non-base64 image data", () => {
    expect(
      validateChatImageData("data:image/png;base64,abc", "image/png"),
    ).toBe("Image data must be valid base64.");
  });

  it("rejects base64 data that does not match the declared MIME type", () => {
    expect(validateChatImageData("aGVsbG8=", "image/png")).toBe(
      "Image data does not match a supported image type.",
    );
    expect(validateChatImageData(ONE_PIXEL_PNG, "image/jpeg")).toBe(
      "Image data does not match the declared image type.",
    );
  });

  it("rejects unsupported MIME types", () => {
    expect(validateChatImageData(ONE_PIXEL_PNG, "image/svg+xml")).toBe(
      "Only PNG, JPEG, GIF, and WebP images are supported.",
    );
  });
});
