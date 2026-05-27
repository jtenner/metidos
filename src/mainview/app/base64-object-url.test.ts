import { describe, expect, it } from "bun:test";
import { base64ToBlob, createBase64ObjectUrl } from "./base64-object-url";

describe("base64 object URL helpers", () => {
  it("decodes base64 into a typed blob", async () => {
    const blob = base64ToBlob(btoa("hello"), "text/plain");

    expect(blob.type.startsWith("text/plain")).toBe(true);
    expect(blob.size).toBe(5);
    expect(await blob.text()).toBe("hello");
  });

  it("creates object URLs from blobs instead of data URLs", () => {
    const blobs: Blob[] = [];
    const url = createBase64ObjectUrl(btoa("image-bytes"), "image/png", {
      createObjectURL: (blob) => {
        blobs.push(blob);
        return "blob:preview";
      },
      revokeObjectURL: () => {},
    });

    expect(url).toBe("blob:preview");
    expect(url.startsWith("data:")).toBe(false);
    expect(blobs).toHaveLength(1);
    expect(blobs[0]?.type).toBe("image/png");
  });
});
