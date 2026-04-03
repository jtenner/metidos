import { Database } from "bun:sqlite";
import { afterEach, describe, expect, it } from "bun:test";

import { listSecurityAuditEvents, migrateDatabase } from "./db";
import {
  buildOpenSslConfig,
  detectTlsBootstrapStrategy,
  parseTlsBootstrapArgs,
  recordTlsBootstrapAuditEvent,
} from "./tls-bootstrap";

const openDatabases = new Set<Database>();

function createTestDatabase(): Database {
  const database = new Database(":memory:");
  migrateDatabase(database);
  openDatabases.add(database);
  return database;
}

afterEach(() => {
  for (const database of openDatabases) {
    database.close(false);
  }
  openDatabases.clear();
});

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

  it("records completed TLS bootstrap runs in the security audit log", () => {
    const database = createTestDatabase();

    recordTlsBootstrapAuditEvent(database, {
      forceOverwrite: true,
      strategy: "mkcert",
      trustSystemCertificate: true,
    });

    expect(listSecurityAuditEvents(database)[0]).toMatchObject({
      eventType: "tls_bootstrap_completed",
      summaryText:
        "TLS bootstrap completed for the local loopback certificate flow.",
    });
    expect(listSecurityAuditEvents(database)[0]?.payloadJson).toContain(
      '"strategy":"mkcert"',
    );
    expect(listSecurityAuditEvents(database)[0]?.payloadJson).toContain(
      '"trustSystemCertificate":true',
    );
  });
});
