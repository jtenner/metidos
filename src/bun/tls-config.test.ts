import { afterEach, describe, expect, it } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  formatLoopbackHttpOrigin,
  formatLoopbackWebSocketUrl,
  getDefaultTlsPaths,
  resolveTlsRuntimeConfig,
  TLS_CA_PATH_ENV,
  TLS_CERT_PATH_ENV,
  TLS_KEY_PATH_ENV,
} from "./tls-config";

const tempDirectories = new Set<string>();

function createTempDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), "jolt-tls-config-"));
  tempDirectories.add(path);
  return path;
}

function writeDefaultTlsFiles(appDataDir: string): void {
  const paths = getDefaultTlsPaths({
    appDataDir,
  });
  mkdirSync(join(appDataDir, "tls"), {
    recursive: true,
  });
  writeFileSync(paths.certPath, "cert");
  writeFileSync(paths.keyPath, "key");
  cpSync(paths.certPath, paths.caPath);
}

afterEach(() => {
  for (const path of tempDirectories) {
    rmSync(path, {
      force: true,
      recursive: true,
    });
  }
  tempDirectories.clear();
});

describe("tls runtime config", () => {
  it("builds loopback origins with the active transport protocol", () => {
    expect(formatLoopbackHttpOrigin(7599, false)).toBe("http://127.0.0.1:7599");
    expect(formatLoopbackHttpOrigin(7599, true)).toBe("https://127.0.0.1:7599");
    expect(formatLoopbackWebSocketUrl(7600, false)).toBe(
      "ws://127.0.0.1:7600/rpc",
    );
    expect(formatLoopbackWebSocketUrl(7600, true)).toBe(
      "wss://127.0.0.1:7600/rpc",
    );
  });

  it("resolves default TLS paths inside the app data directory", () => {
    const appDataDir = createTempDirectory();
    expect(
      getDefaultTlsPaths({
        appDataDir,
      }),
    ).toEqual({
      caPath: join(appDataDir, "tls", "loopback-ca.pem"),
      certPath: join(appDataDir, "tls", "loopback-cert.pem"),
      keyPath: join(appDataDir, "tls", "loopback-key.pem"),
    });
  });

  it("allows plaintext transport in dev mode when no TLS material exists", () => {
    const appDataDir = createTempDirectory();
    expect(
      resolveTlsRuntimeConfig({
        appDataDir,
        env: {},
        isDevServer: true,
      }),
    ).toMatchObject({
      enabled: false,
      httpProtocol: "http",
      required: false,
      websocketProtocol: "ws",
    });
  });

  it("requires TLS outside dev mode and points users to the bootstrap helper", () => {
    const appDataDir = createTempDirectory();
    expect(() =>
      resolveTlsRuntimeConfig({
        appDataDir,
        env: {},
        isDevServer: false,
      }),
    ).toThrow("bun run tls:bootstrap");
  });

  it("enables HTTPS and WSS when default loopback certificates are present", () => {
    const appDataDir = createTempDirectory();
    writeDefaultTlsFiles(appDataDir);

    expect(
      resolveTlsRuntimeConfig({
        appDataDir,
        env: {},
        isDevServer: false,
      }),
    ).toMatchObject({
      caPath: join(appDataDir, "tls", "loopback-ca.pem"),
      enabled: true,
      httpProtocol: "https",
      required: true,
      websocketProtocol: "wss",
    });
  });

  it("requires explicit cert and key overrides to be set together", () => {
    const appDataDir = createTempDirectory();
    expect(() =>
      resolveTlsRuntimeConfig({
        appDataDir,
        env: {
          [TLS_CERT_PATH_ENV]: join(appDataDir, "cert.pem"),
        },
        isDevServer: true,
      }),
    ).toThrow(`Set both ${TLS_CERT_PATH_ENV} and ${TLS_KEY_PATH_ENV} together`);
  });

  it("rejects a missing explicit CA override", () => {
    const appDataDir = createTempDirectory();
    writeDefaultTlsFiles(appDataDir);

    expect(() =>
      resolveTlsRuntimeConfig({
        appDataDir,
        env: {
          [TLS_CA_PATH_ENV]: join(appDataDir, "missing-ca.pem"),
        },
        isDevServer: false,
      }),
    ).toThrow("Missing TLS file");
  });
});
