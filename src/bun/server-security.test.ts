import { describe, expect, it } from "bun:test";

import {
  buildLivenessPayload,
  buildLoopbackBrowserOrigins,
  isWebSocketOriginAllowed,
  parseAllowedBrowserOrigins,
} from "./server-security";

describe("server security helpers", () => {
  it("builds loopback origins for localhost and 127.0.0.1", () => {
    expect(buildLoopbackBrowserOrigins(7599)).toEqual([
      "http://127.0.0.1:7599",
      "https://127.0.0.1:7599",
      "http://localhost:7599",
      "https://localhost:7599",
    ]);
  });

  it("parses and normalizes configured origins", () => {
    expect(
      parseAllowedBrowserOrigins(
        "http://localhost:7599,\nhttps://127.0.0.1:7600 http://localhost:7599",
      ),
    ).toEqual(["http://localhost:7599", "https://127.0.0.1:7600"]);
  });

  it("rejects malformed configured origins", () => {
    expect(() => parseAllowedBrowserOrigins("ws://localhost:7599")).toThrow(
      'Invalid browser origin "ws://localhost:7599".',
    );
  });

  it("allows missing Origin for non-browser local clients", () => {
    expect(
      isWebSocketOriginAllowed(null, buildLoopbackBrowserOrigins(7599)),
    ).toBeTrue();
  });

  it("accepts exact allowlisted browser origins", () => {
    expect(
      isWebSocketOriginAllowed(
        "https://localhost:7599",
        buildLoopbackBrowserOrigins(7599),
      ),
    ).toBeTrue();
  });

  it("rejects non-allowlisted browser origins", () => {
    expect(
      isWebSocketOriginAllowed(
        "https://evil.example",
        buildLoopbackBrowserOrigins(7599),
      ),
    ).toBeFalse();
  });

  it("returns a minimal liveness payload", () => {
    expect(buildLivenessPayload(false)).toEqual({
      ok: false,
    });
  });
});
