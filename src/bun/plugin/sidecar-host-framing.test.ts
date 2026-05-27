/**
 * @file src/bun/plugin/sidecar-host-framing.test.ts
 * @description Tests for Plugin System v1 sidecar host-request framing helpers.
 */

import { describe, expect, it } from "bun:test";

import { PluginCalendarEventsError } from "./calendar-events";
import {
  createPluginHostErrorFrame,
  createPluginHostResponseFrame,
  normalizePluginHostRequestPayload,
  selectPluginHostRequestErrorCode,
} from "./sidecar-host-framing";
import {
  decodePluginSidecarRpcEnvelope,
  type PluginSidecarHostRequestEnvelope,
} from "./sidecar-rpc";

function hostRequest(
  operation: string,
  params: unknown = { params: { ok: true } },
): PluginSidecarHostRequestEnvelope {
  return {
    id: `request-${operation}`,
    payload: { operation, params },
    pluginId: "test_plugin",
    type: "sidecar.request",
  };
}

describe("plugin sidecar host framing helpers", () => {
  it("creates success frames with request correlation and result payloads", () => {
    const envelope = hostRequest("fs.read");
    const frame = createPluginHostResponseFrame({
      envelope,
      pluginId: "test_plugin",
      result: { text: "hello" },
    });

    expect(typeof frame).toBe("string");
    expect(
      decodePluginSidecarRpcEnvelope(frame as string, {
        expectedPluginId: "test_plugin",
      }),
    ).toEqual({
      envelope: {
        id: `${envelope.id}:response`,
        payload: { requestId: envelope.id, result: { text: "hello" } },
        pluginId: "test_plugin",
        type: "host.response",
      },
      ok: true,
    });
  });

  it("creates non-retryable host error frames for unsupported operations", () => {
    const envelope = hostRequest("missing.operation");
    const frame = createPluginHostErrorFrame({
      code: "unsupported_operation",
      envelope,
      message: "Plugin host operation missing.operation is not supported.",
      pluginId: "test_plugin",
    });

    expect(
      decodePluginSidecarRpcEnvelope(frame as string, {
        expectedPluginId: "test_plugin",
      }),
    ).toEqual({
      envelope: {
        id: `${envelope.id}:error`,
        payload: {
          code: "unsupported_operation",
          message: "Plugin host operation missing.operation is not supported.",
          requestId: envelope.id,
          retryable: false,
        },
        pluginId: "test_plugin",
        type: "host.error",
      },
      ok: true,
    });
  });

  it("normalizes malformed request, context, and params objects safely", () => {
    expect(
      normalizePluginHostRequestPayload(hostRequest("fs.read", null)),
    ).toEqual({
      context: null,
      params: {},
      request: {},
    });
    expect(
      normalizePluginHostRequestPayload(
        hostRequest("fs.read", { context: [], params: "bad" }),
      ),
    ).toEqual({
      context: null,
      params: {},
      request: { context: [], params: "bad" },
    });
  });

  it("maps operation families and known Plugin errors to stable error codes", () => {
    expect(
      selectPluginHostRequestErrorCode({
        error: new Error("boom"),
        operation: "fs.read",
      }),
    ).toBe("plugin_fs_failed");

    expect(
      selectPluginHostRequestErrorCode({
        error: "boom",
        operation: "sqlite.get",
      }),
    ).toBe("plugin_sqlite_failed");

    expect(
      selectPluginHostRequestErrorCode({
        error: "boom",
        operation: "events.list",
      }),
    ).toBe("plugin_calendar_events_failed");

    expect(
      selectPluginHostRequestErrorCode({
        error: "boom",
        operation: "terminal.create",
      }),
    ).toBe("plugin_terminal_failed");

    expect(
      selectPluginHostRequestErrorCode({
        error: "boom",
        operation: "websocket.connect",
      }),
    ).toBe("plugin_websocket_failed");

    expect(
      selectPluginHostRequestErrorCode({
        error: "boom",
        operation: "metidos.log",
      }),
    ).toBe("plugin_log_failed");

    expect(
      selectPluginHostRequestErrorCode({
        error: "boom",
        operation: "notifications.send",
      }),
    ).toBe("plugin_notification_failed");

    expect(
      selectPluginHostRequestErrorCode({
        error: new PluginCalendarEventsError({
          code: "plugin_calendar_permission_denied",
          message: "No calendar access.",
        }),
        operation: "events.list",
      }),
    ).toBe("plugin_calendar_permission_denied");
  });
});
