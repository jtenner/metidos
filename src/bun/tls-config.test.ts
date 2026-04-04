import { describe, expect, it } from "bun:test";

import {
  formatLoopbackHttpOrigin,
  formatLoopbackWebSocketUrl,
  isPublicTlsEnabled,
  resolveTlsRuntimeConfig,
  TLS_PUBLIC_TRANSPORT_ENV,
} from "./tls-config";

describe("tls runtime config", () => {
  it("builds loopback origins with the requested public transport protocol", () => {
    expect(formatLoopbackHttpOrigin(7599, false)).toBe("http://127.0.0.1:7599");
    expect(formatLoopbackHttpOrigin(7599, true)).toBe("https://127.0.0.1:7599");
    expect(formatLoopbackWebSocketUrl(7600, false)).toBe(
      "ws://127.0.0.1:7600/rpc",
    );
    expect(formatLoopbackWebSocketUrl(7600, true)).toBe(
      "wss://127.0.0.1:7600/rpc",
    );
  });

  it("defaults to plaintext public transport", () => {
    expect(
      resolveTlsRuntimeConfig({
        env: {},
      }),
    ).toEqual({
      publicHttpProtocol: "http",
      publicTls: false,
      publicWebSocketProtocol: "ws",
    });
  });

  it("forces public https and wss when the public TLS flag is enabled", () => {
    expect(
      resolveTlsRuntimeConfig({
        env: {},
        forceTls: true,
      }),
    ).toEqual({
      publicHttpProtocol: "https",
      publicTls: true,
      publicWebSocketProtocol: "wss",
    });
  });

  it("detects the public TLS mode from CLI args or env", () => {
    expect(isPublicTlsEnabled([])).toBe(false);
    expect(isPublicTlsEnabled(["--tls"])).toBe(true);
    expect(
      isPublicTlsEnabled([], {
        [TLS_PUBLIC_TRANSPORT_ENV]: "1",
      }),
    ).toBe(true);
  });
});
