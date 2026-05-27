import { describe, expect, test } from "bun:test";
import {
  decodeRpcBinaryFrame,
  encodeRpcBinaryFrame,
  isRpcBinaryFrame,
} from "./rpc-binary-codec";

describe("RPC binary codec", () => {
  test("round-trips representative RPC structs without JSON text frames", async () => {
    const payload = {
      type: "response",
      id: 42,
      ok: false,
      result: null,
      error: "Nope",
      errorCode: "validation_failed",
      errorDetails: {
        field: "name",
        optional: null,
      },
      nested: {
        values: ["text", 3.5, true, false, null, { child: "value" }],
      },
    };

    const encoded = await encodeRpcBinaryFrame(payload);

    expect(isRpcBinaryFrame(encoded)).toBe(true);
    expect(new TextDecoder().decode(encoded).includes('"response"')).toBe(
      false,
    );
    expect(await decodeRpcBinaryFrame(encoded)).toEqual(payload);
  });

  test("compresses large binary struct payloads", async () => {
    const payload = {
      type: "response",
      id: 7,
      ok: true,
      result: {
        repeated: "x".repeat(64 * 1024),
      },
    };

    const encoded = await encodeRpcBinaryFrame(payload);

    expect(encoded.byteLength).toBeLessThan(payload.result.repeated.length / 2);
    expect(await decodeRpcBinaryFrame(encoded)).toEqual(payload);
  });

  test("can leave large binary struct payloads uncompressed", async () => {
    const payload = {
      type: "response",
      id: 8,
      ok: true,
      result: {
        repeated: "x".repeat(64 * 1024),
      },
    };

    const encoded = await encodeRpcBinaryFrame(payload, { compress: false });

    expect(encoded[3]).toBe(0);
    expect(encoded.byteLength).toBeGreaterThan(payload.result.repeated.length);
    expect(await decodeRpcBinaryFrame(encoded)).toEqual(payload);
  });

  test("rejects compressed frames when the caller disallows them", async () => {
    const encoded = await encodeRpcBinaryFrame({
      type: "request",
      id: 9,
      method: "sendThreadMessage",
      params: { body: "x".repeat(64 * 1024) },
    });

    expect(encoded[3]).toBe(1);
    await expect(
      decodeRpcBinaryFrame(encoded, { allowCompressed: false }),
    ).rejects.toThrow("Compressed RPC binary frames are not accepted.");
  });

  test("enforces the decoded byte limit before returning payloads", async () => {
    const encoded = await encodeRpcBinaryFrame(
      {
        type: "request",
        id: 10,
        method: "sendThreadMessage",
        params: { body: "x".repeat(64 * 1024) },
      },
      { compress: false },
    );

    await expect(
      decodeRpcBinaryFrame(encoded, { maxDecodedBodyBytes: 1024 }),
    ).rejects.toThrow("RPC binary frame exceeds decoded byte limit.");
  });
});
