import { describe, expect, it } from "bun:test";

import {
  buildOpenSslConfig,
  detectTlsBootstrapStrategy,
  parseTlsBootstrapArgs,
} from "./tls-bootstrap";

describe("tls bootstrap helpers", () => {
  it("parses supported flags", () => {
    expect(parseTlsBootstrapArgs(["--trust", "--force"])).toEqual({
      forceOverwrite: true,
      trustSystemCertificate: true,
    });
  });

  it("rejects unknown flags", () => {
    expect(() => parseTlsBootstrapArgs(["--wat"])).toThrow(
      'Unknown tls bootstrap flag "--wat".',
    );
  });

  it("prefers mkcert when it is available", () => {
    expect(
      detectTlsBootstrapStrategy((command) => {
        if (command === "mkcert") {
          return "/usr/bin/mkcert";
        }
        if (command === "openssl") {
          return "/usr/bin/openssl";
        }
        return null;
      }),
    ).toBe("mkcert");
  });

  it("falls back to openssl when mkcert is unavailable", () => {
    expect(
      detectTlsBootstrapStrategy((command) =>
        command === "openssl" ? "/usr/bin/openssl" : null,
      ),
    ).toBe("openssl");
  });

  it("returns null when no supported TLS helper is installed", () => {
    expect(detectTlsBootstrapStrategy(() => null)).toBeNull();
  });

  it("builds an openssl config with loopback SAN entries", () => {
    expect(buildOpenSslConfig()).toContain("DNS.1 = localhost");
    expect(buildOpenSslConfig()).toContain("IP.1 = 127.0.0.1");
    expect(buildOpenSslConfig()).toContain("IP.2 = ::1");
  });
});
