import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createPiAuthStorage,
  resolvePiAuthFilePath,
  translateCodexAuthToPiCredential,
} from "./pi-codex-auth";

const originalCodexHome = process.env.CODEX_HOME;

function encodeBase64Url(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function createJwt(payload: Record<string, unknown>): string {
  return [
    encodeBase64Url(JSON.stringify({ alg: "none", typ: "JWT" })),
    encodeBase64Url(JSON.stringify(payload)),
    "signature",
  ].join(".");
}

afterEach(() => {
  if (typeof originalCodexHome === "string") {
    process.env.CODEX_HOME = originalCodexHome;
  } else {
    delete process.env.CODEX_HOME;
  }
});

test("translateCodexAuthToPiCredential maps Codex auth tokens into Pi OAuth credentials", () => {
  const accessToken = createJwt({
    exp: 1_901_234_567,
    sub: "user-123",
  });

  expect(
    translateCodexAuthToPiCredential({
      auth_mode: "chatgpt",
      tokens: {
        access_token: accessToken,
        account_id: "acct_123",
        refresh_token: "refresh_123",
      },
    }),
  ).toEqual({
    access: accessToken,
    accountId: "acct_123",
    expires: 1_901_234_567_000,
    refresh: "refresh_123",
  });
});

test("createPiAuthStorage syncs ~/.codex/auth.json into Pi auth and overrides stale Codex credentials", () => {
  const agentDirectory = mkdtempSync(join(tmpdir(), "jolt-pi-auth-agent-"));
  const codexHome = mkdtempSync(join(tmpdir(), "jolt-codex-home-"));
  process.env.CODEX_HOME = codexHome;

  const stalePiAccessToken = createJwt({
    exp: 1_800_000_000,
  });
  const codexAccessToken = createJwt({
    exp: 1_950_000_000,
  });

  try {
    writeFileSync(
      resolvePiAuthFilePath(agentDirectory),
      JSON.stringify(
        {
          "openai-codex": {
            access: stalePiAccessToken,
            accountId: "acct_stale",
            expires: 1_800_000_000_000,
            refresh: "refresh_stale",
            type: "oauth",
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    writeFileSync(
      join(codexHome, "auth.json"),
      JSON.stringify(
        {
          auth_mode: "chatgpt",
          tokens: {
            access_token: codexAccessToken,
            account_id: "acct_live",
            refresh_token: "refresh_live",
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const { authStorage, codexAuthState } = createPiAuthStorage(agentDirectory);

    expect(codexAuthState).toEqual(
      expect.objectContaining({
        overrideApplied: true,
        reason: "synced_from_codex_auth_file",
        source: "codex-file",
      }),
    );
    expect(authStorage.get("openai-codex")).toEqual({
      access: codexAccessToken,
      accountId: "acct_live",
      expires: 1_950_000_000_000,
      refresh: "refresh_live",
      type: "oauth",
    });
    expect(
      JSON.parse(readFileSync(resolvePiAuthFilePath(agentDirectory), "utf8")),
    ).toEqual({
      "openai-codex": {
        access: codexAccessToken,
        accountId: "acct_live",
        expires: 1_950_000_000_000,
        refresh: "refresh_live",
        type: "oauth",
      },
    });
  } finally {
    rmSync(agentDirectory, {
      force: true,
      recursive: true,
    });
    rmSync(codexHome, {
      force: true,
      recursive: true,
    });
  }
});

test("createPiAuthStorage falls back to Pi Codex auth when the Codex file is missing or unusable", () => {
  const agentDirectory = mkdtempSync(join(tmpdir(), "jolt-pi-auth-agent-"));
  const missingCodexHome = mkdtempSync(join(tmpdir(), "jolt-codex-home-"));
  const invalidCodexHome = mkdtempSync(join(tmpdir(), "jolt-codex-home-"));
  const incompleteCodexHome = mkdtempSync(join(tmpdir(), "jolt-codex-home-"));
  const persistedAccessToken = createJwt({
    exp: 1_920_000_000,
  });

  try {
    writeFileSync(
      resolvePiAuthFilePath(agentDirectory),
      JSON.stringify(
        {
          "openai-codex": {
            access: persistedAccessToken,
            accountId: "acct_pi",
            expires: 1_920_000_000_000,
            refresh: "refresh_pi",
            type: "oauth",
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    process.env.CODEX_HOME = missingCodexHome;
    expect(createPiAuthStorage(agentDirectory).codexAuthState).toEqual(
      expect.objectContaining({
        overrideApplied: false,
        reason: "using_existing_pi_codex_auth",
        source: "pi-auth",
      }),
    );

    writeFileSync(join(invalidCodexHome, "auth.json"), "{not json", "utf8");
    process.env.CODEX_HOME = invalidCodexHome;
    expect(createPiAuthStorage(agentDirectory).codexAuthState).toEqual(
      expect.objectContaining({
        overrideApplied: false,
        reason: "codex_auth_file_unusable_fell_back_to_pi_auth",
        source: "pi-auth",
      }),
    );

    writeFileSync(
      join(incompleteCodexHome, "auth.json"),
      JSON.stringify(
        {
          auth_mode: "chatgpt",
          tokens: {
            access_token: persistedAccessToken,
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    process.env.CODEX_HOME = incompleteCodexHome;
    expect(createPiAuthStorage(agentDirectory).codexAuthState).toEqual(
      expect.objectContaining({
        overrideApplied: false,
        reason: "codex_auth_file_unusable_fell_back_to_pi_auth",
        source: "pi-auth",
      }),
    );
  } finally {
    rmSync(agentDirectory, {
      force: true,
      recursive: true,
    });
    rmSync(missingCodexHome, {
      force: true,
      recursive: true,
    });
    rmSync(invalidCodexHome, {
      force: true,
      recursive: true,
    });
    rmSync(incompleteCodexHome, {
      force: true,
      recursive: true,
    });
  }
});

test("createPiAuthStorage surfaces missing and unusable Codex-file reasons when no Pi fallback exists", () => {
  const agentDirectory = mkdtempSync(join(tmpdir(), "jolt-pi-auth-agent-"));
  const missingCodexHome = mkdtempSync(join(tmpdir(), "jolt-codex-home-"));
  const incompleteCodexHome = mkdtempSync(join(tmpdir(), "jolt-codex-home-"));

  try {
    process.env.CODEX_HOME = missingCodexHome;
    expect(createPiAuthStorage(agentDirectory).codexAuthState).toEqual(
      expect.objectContaining({
        overrideApplied: false,
        reason: "codex_auth_file_missing",
        source: "none",
      }),
    );

    writeFileSync(
      join(incompleteCodexHome, "auth.json"),
      JSON.stringify(
        {
          auth_mode: "chatgpt",
          tokens: {
            access_token: createJwt({
              exp: 1_920_000_000,
            }),
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    process.env.CODEX_HOME = incompleteCodexHome;
    expect(createPiAuthStorage(agentDirectory).codexAuthState).toEqual(
      expect.objectContaining({
        overrideApplied: false,
        reason: "codex_auth_file_unusable",
        source: "none",
      }),
    );
  } finally {
    rmSync(agentDirectory, {
      force: true,
      recursive: true,
    });
    rmSync(missingCodexHome, {
      force: true,
      recursive: true,
    });
    rmSync(incompleteCodexHome, {
      force: true,
      recursive: true,
    });
  }
});
