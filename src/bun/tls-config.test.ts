import { describe, expect, it } from "bun:test";
import {
  TLS_PUBLIC_TRANSPORT_ENV,
  formatLoopbackHttpOrigin,
  formatLoopbackWebSocketUrl,
  isPublicTlsEnabled,
  resolveTlsRuntimeConfig,
} from "./tls-config";

describe("tls runtime config", () => {
  it("formats loopback origins with the resolved transport", () => {
    expect(formatLoopbackHttpOrigin(4291, false)).toBe("http://127.0.0.1:4291");
    expect(formatLoopbackHttpOrigin(4291, true)).toBe("https://127.0.0.1:4291");
    expect(formatLoopbackWebSocketUrl(4291, false)).toBe(
      "ws://127.0.0.1:4291/rpc",
    );
    expect(formatLoopbackWebSocketUrl(4291, true)).toBe(
      "wss://127.0.0.1:4291/rpc",
    );
  });

  it("enables public TLS only for the CLI flag or exact enabled env value", () => {
    expect(isPublicTlsEnabled(["--tls"], {})).toBe(true);
    expect(isPublicTlsEnabled([], { [TLS_PUBLIC_TRANSPORT_ENV]: "1" })).toBe(
      true,
    );
    expect(isPublicTlsEnabled([], { [TLS_PUBLIC_TRANSPORT_ENV]: " 1 " })).toBe(
      true,
    );
    expect(isPublicTlsEnabled([], { [TLS_PUBLIC_TRANSPORT_ENV]: "true" })).toBe(
      false,
    );
    expect(isPublicTlsEnabled([], { [TLS_PUBLIC_TRANSPORT_ENV]: "0" })).toBe(
      false,
    );
    expect(isPublicTlsEnabled([], {})).toBe(false);
  });

  it("keeps HTTP/WS public protocols by default and switches both protocols together for TLS", () => {
    expect(resolveTlsRuntimeConfig({ env: {} })).toEqual({
      publicHttpProtocol: "http",
      publicTls: false,
      publicWebSocketProtocol: "ws",
    });
    expect(
      resolveTlsRuntimeConfig({ env: { [TLS_PUBLIC_TRANSPORT_ENV]: "1" } }),
    ).toEqual({
      publicHttpProtocol: "https",
      publicTls: true,
      publicWebSocketProtocol: "wss",
    });
    expect(resolveTlsRuntimeConfig({ env: {}, forceTls: true })).toEqual({
      publicHttpProtocol: "https",
      publicTls: true,
      publicWebSocketProtocol: "wss",
    });
  });
});
