/**
 * @file src/bun/plugin/sidecar-rpc.test.ts
 * @description Tests for Metidos plugin sidecar RPC protocol schemas and safety limits.
 */

import { describe, expect, it } from "bun:test";

import {
  decodePluginSidecarRpcEnvelope,
  encodePluginSidecarRpcEnvelope,
  PLUGIN_SIDECAR_RPC_MAX_PAYLOAD_BYTES,
  PLUGIN_SIDECAR_RPC_PROTOCOL_VERSION,
  type PluginSidecarEnvelope,
} from "./sidecar-rpc";

function validEnvelope(
  extra: Record<string, unknown> = {},
): PluginSidecarEnvelope {
  return {
    id: "request-1",
    payload: {
      operation: "tool.call",
      params: { message: "hello" },
    },
    pluginId: "hello_tool",
    type: "host.request",
    ...extra,
  } as PluginSidecarEnvelope;
}

function decode(value: unknown, expectedPluginId = "hello_tool") {
  return decodePluginSidecarRpcEnvelope(JSON.stringify(value), {
    expectedPluginId,
  });
}

describe("plugin sidecar RPC protocol", () => {
  it("round-trips valid host request envelopes as newline-delimited JSON", () => {
    const envelope = validEnvelope();
    const encoded = encodePluginSidecarRpcEnvelope(envelope);

    expect(typeof encoded).toBe("string");
    expect(encoded).toEndWith("\n");

    const decoded = decodePluginSidecarRpcEnvelope(encoded as string, {
      expectedPluginId: "hello_tool",
    });

    expect(decoded).toEqual({ envelope, ok: true });
  });

  it("accepts the core host and sidecar envelope variants", () => {
    const envelopes: PluginSidecarEnvelope[] = [
      validEnvelope({
        payload: {
          apiVersion: "v1",
          env: [
            {
              key: "HELLO_TOKEN",
              required: true,
              secret: true,
              value: "present",
            },
          ],
          protocolVersion: PLUGIN_SIDECAR_RPC_PROTOCOL_VERSION,
          reviewHash: "abc123",
          settings: {
            missingRequiredKeys: ["api_token"],
            values: { api_token: null, refresh_minutes: 10 },
          },
        },
        type: "host.startup",
      }),
      validEnvelope({
        payload: { reason: "timeout", targetId: "request-1" },
        type: "host.cancel",
      }),
      validEnvelope({
        payload: { graceMs: 1000, reason: "host_shutdown" },
        type: "host.shutdown",
      }),
      validEnvelope({
        payload: {
          protocolVersion: PLUGIN_SIDECAR_RPC_PROTOCOL_VERSION,
          registrations: { tools: [] },
        },
        type: "sidecar.ready",
      }),
      validEnvelope({
        payload: { requestId: "request-1", result: { ok: true } },
        type: "sidecar.response",
      }),
      validEnvelope({
        payload: {
          code: "plugin_failure",
          message: "Plugin failed.",
          requestId: "request-1",
        },
        type: "sidecar.error",
      }),
      validEnvelope({
        payload: { event: "registration.updated", value: { tools: [] } },
        type: "sidecar.event",
      }),
    ];

    for (const envelope of envelopes) {
      expect(decode(envelope)).toEqual({ envelope, ok: true });
    }
  });

  it("rejects malformed protocol frames before dispatch", () => {
    expect(decodePluginSidecarRpcEnvelope("not json")).toEqual({
      error: {
        code: "invalid_json",
        message: "Plugin sidecar protocol frame must be valid JSON.",
      },
      ok: false,
    });

    expect(decodePluginSidecarRpcEnvelope("{}\n{}\n").ok).toBe(false);
    expect(decode([]).ok).toBe(false);
    expect(decode({ ...validEnvelope(), payload: "nope" }).ok).toBe(false);
    expect(decode({ ...validEnvelope(), id: "" }).ok).toBe(false);
  });

  it("rejects unknown envelope types", () => {
    const result = decode({
      ...validEnvelope(),
      type: "plugin-defined.rpc",
    });

    expect(result).toEqual({
      error: {
        code: "unknown_envelope_type",
        message: "Plugin sidecar protocol envelope type is unknown or missing.",
        requestId: "request-1",
      },
      ok: false,
    });
  });

  it("rejects envelopes for the wrong plugin", () => {
    const result = decode(validEnvelope({ pluginId: "other_plugin" }));

    expect(result).toEqual({
      error: {
        code: "wrong_plugin",
        message:
          "Plugin sidecar protocol envelope pluginId did not match the expected plugin.",
        pluginId: "other_plugin",
        requestId: "request-1",
      },
      ok: false,
    });
  });

  it("rejects oversized protocol frames", () => {
    const oversizedEnvelope = validEnvelope({
      payload: {
        operation: "tool.call",
        params: "x".repeat(PLUGIN_SIDECAR_RPC_MAX_PAYLOAD_BYTES),
      },
    });

    const encoded = encodePluginSidecarRpcEnvelope(oversizedEnvelope);
    expect(encoded).toEqual({
      error: {
        code: "oversized_payload",
        message:
          "Plugin sidecar protocol frame exceeds the 8 MB payload limit.",
        pluginId: "hello_tool",
        requestId: "request-1",
      },
      ok: false,
    });

    const rawFrame = JSON.stringify(oversizedEnvelope);
    const decoded = decodePluginSidecarRpcEnvelope(rawFrame, {
      expectedPluginId: "hello_tool",
    });
    expect(decoded).toEqual({
      error: {
        code: "oversized_payload",
        message:
          "Plugin sidecar protocol frame exceeds the 8 MB payload limit.",
      },
      ok: false,
    });
  });

  it("validates typed payload rules for protocol versions and correlated responses", () => {
    expect(
      decode(
        validEnvelope({
          payload: {
            apiVersion: "v1",
            env: [],
            protocolVersion: 999,
            reviewHash: "abc123",
          },
          type: "host.startup",
        }),
      ),
    ).toEqual({
      error: {
        code: "invalid_protocol_version",
        message: "Plugin sidecar startup payload is invalid.",
        pluginId: "hello_tool",
        requestId: "request-1",
      },
      ok: false,
    });

    expect(
      decode(
        validEnvelope({
          payload: { result: { ok: true } },
          type: "sidecar.response",
        }),
      ),
    ).toEqual({
      error: {
        code: "invalid_payload",
        message: "Plugin sidecar response requestId is required.",
        pluginId: "hello_tool",
        requestId: "request-1",
      },
      ok: false,
    });
  });
});
