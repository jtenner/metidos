/**
 * @file src/bun/project-procedures/provider-auth.test.ts
 * @description Focused coverage for backend-managed OpenAI Codex auth procedures.
 */

import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeAppDatabase, resetResolvedAppDataDirectory } from "../db";
import {
  resetPiCodexAuthTestOverrides,
  setPiCodexAuthTestOverrides,
} from "../pi-codex-auth";
import { resetProviderAuthStateForTests } from "./provider-auth";

type ProjectProceduresModule = typeof import("../project-procedures");

const tempDirectories = new Set<string>();
const originalAppDataDir = process.env.JOLT_APP_DATA_DIR;
const originalCodexHome = process.env.CODEX_HOME;

function createTempDirectory(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), prefix));
  tempDirectories.add(path);
  return path;
}

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

async function loadProjectProceduresForTest(options: {
  appDataDir: string;
  codexHome: string;
}): Promise<ProjectProceduresModule> {
  closeAppDatabase();
  resetResolvedAppDataDirectory();
  process.env.JOLT_APP_DATA_DIR = options.appDataDir;
  process.env.CODEX_HOME = options.codexHome;

  return (await import(
    `../project-procedures?provider-auth-test=${Date.now()}`
  )) as ProjectProceduresModule;
}

afterEach(async () => {
  resetPiCodexAuthTestOverrides();
  resetProviderAuthStateForTests();
  closeAppDatabase();
  resetResolvedAppDataDirectory();

  if (typeof originalAppDataDir === "string") {
    process.env.JOLT_APP_DATA_DIR = originalAppDataDir;
  } else {
    delete process.env.JOLT_APP_DATA_DIR;
  }
  if (typeof originalCodexHome === "string") {
    process.env.CODEX_HOME = originalCodexHome;
  } else {
    delete process.env.CODEX_HOME;
  }
});

afterAll(() => {
  for (const path of tempDirectories) {
    rmSync(path, {
      force: true,
      recursive: true,
    });
  }
  tempDirectories.clear();
});

describe("provider auth procedures", () => {
  it("surfaces missing and unusable Codex-file diagnostics through provider-auth status", async () => {
    const appDataDir = createTempDirectory("jolt-provider-auth-app-");
    const missingCodexHome = createTempDirectory("jolt-provider-auth-codex-");
    const unusableCodexHome = createTempDirectory("jolt-provider-auth-codex-");

    writeFileSync(
      join(missingCodexHome, "config.toml"),
      'cli_auth_credentials_store = "keyring"\n',
      "utf8",
    );

    const missingProcedures = await loadProjectProceduresForTest({
      appDataDir,
      codexHome: missingCodexHome,
    });
    const missingStatus =
      await missingProcedures.getProviderAuthStatusProcedure({
        providerId: "openai-codex",
      });
    expect(missingStatus.provider).toEqual(
      expect.objectContaining({
        codexConfigFilePath: join(missingCodexHome, "config.toml"),
        codexCredentialStoreMode: "keyring",
        configured: false,
        source: "none",
        sourceReason: "codex_auth_file_missing",
      }),
    );
    expect(missingStatus.modelCatalog.defaultModel).toBe("openai:gpt-5.4");

    writeFileSync(
      join(unusableCodexHome, "auth.json"),
      JSON.stringify(
        {
          auth_mode: "chatgpt",
          tokens: {
            access_token: createJwt({
              exp: 2_000_000_000,
            }),
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    const unusableProcedures = await loadProjectProceduresForTest({
      appDataDir,
      codexHome: unusableCodexHome,
    });
    const unusableStatus =
      await unusableProcedures.getProviderAuthStatusProcedure({
        providerId: "openai-codex",
      });
    expect(unusableStatus.provider).toEqual(
      expect.objectContaining({
        configured: false,
        source: "none",
        sourceReason: "codex_auth_file_unusable",
      }),
    );
    expect(unusableStatus.modelCatalog.defaultModel).toBe("openai:gpt-5.4");
  });

  it("starts and completes a backend-managed Codex login and mirrors it into both auth stores", async () => {
    const appDataDir = createTempDirectory("jolt-provider-auth-app-");
    const codexHome = createTempDirectory("jolt-provider-auth-codex-");
    const procedures = await loadProjectProceduresForTest({
      appDataDir,
      codexHome,
    });

    const accessToken = createJwt({
      "https://api.openai.com/auth": {
        chatgpt_account_id: "acct_login",
      },
      exp: 2_050_000_000,
    });
    setPiCodexAuthTestOverrides({
      login: async (options) => {
        options.onAuth({
          instructions: "Open the browser and finish sign-in.",
          url: "https://auth.example.test/openai-codex",
        });
        const manualCode = await (options.onManualCodeInput?.() ??
          options.onPrompt({
            message: "Paste the authorization code (or full redirect URL):",
          }));
        expect(manualCode).toBe("code=manual-success");
        return {
          access: accessToken,
          accountId: "acct_login",
          expires: 2_050_000_000_000,
          refresh: "refresh_login",
        };
      },
    });

    const startResult = await procedures.startProviderAuthLoginProcedure({
      providerId: "openai-codex",
    });
    expect(startResult.provider).toEqual(
      expect.objectContaining({
        configured: false,
        login: expect.objectContaining({
          authUrl: "https://auth.example.test/openai-codex",
          prompt: "Paste the authorization code or the full redirect URL.",
          state: "awaiting_code",
        }),
        providerId: "openai-codex",
      }),
    );

    const loginId = startResult.provider.login?.loginId;
    expect(typeof loginId).toBe("string");

    const completeResult = await procedures.completeProviderAuthLoginProcedure({
      loginId: loginId ?? "",
      manualCode: "code=manual-success",
      providerId: "openai-codex",
    });

    expect(completeResult.provider).toEqual(
      expect.objectContaining({
        accountId: "acct_login",
        configured: true,
        credentialExpiresAt: "2034-12-17T20:26:40.000Z",
        lastError: null,
        source: "codex-file",
      }),
    );
    expect(completeResult.provider.login).toEqual(
      expect.objectContaining({
        state: "completed",
      }),
    );
    expect(completeResult.modelCatalog.defaultModel).toBe(
      "openai-codex:gpt-5.4",
    );

    const piAuthPath = join(appDataDir, "pi-agent", "auth.json");
    const codexAuthPath = join(codexHome, "auth.json");

    expect(JSON.parse(readFileSync(piAuthPath, "utf8"))).toEqual({
      "openai-codex": {
        access: accessToken,
        accountId: "acct_login",
        expires: 2_050_000_000_000,
        refresh: "refresh_login",
        type: "oauth",
      },
    });
    expect(JSON.parse(readFileSync(codexAuthPath, "utf8"))).toEqual({
      auth_mode: "chatgpt",
      tokens: {
        access_token: accessToken,
        account_id: "acct_login",
        refresh_token: "refresh_login",
      },
    });

    const logoutResult = await procedures.logoutProviderAuthProcedure({
      providerId: "openai-codex",
    });
    expect(logoutResult.provider).toEqual(
      expect.objectContaining({
        configured: false,
        login: null,
        source: "none",
      }),
    );
    expect(logoutResult.modelCatalog.defaultModel).toBe("openai:gpt-5.4");
    expect(JSON.parse(readFileSync(piAuthPath, "utf8"))).toEqual({});
    expect(JSON.parse(readFileSync(codexAuthPath, "utf8"))).toEqual({});
  });

  it("refreshes the effective Codex credential and repairs the authoritative Codex file when needed", async () => {
    const appDataDir = createTempDirectory("jolt-provider-auth-app-");
    const codexHome = createTempDirectory("jolt-provider-auth-codex-");
    const procedures = await loadProjectProceduresForTest({
      appDataDir,
      codexHome,
    });

    const staleAccessToken = createJwt({
      "https://api.openai.com/auth": {
        chatgpt_account_id: "acct_stale",
      },
      exp: 2_000_000_000,
    });
    writeFileSync(
      join(codexHome, "auth.json"),
      JSON.stringify(
        {
          auth_mode: "chatgpt",
          tokens: {
            access_token: staleAccessToken,
            account_id: "acct_stale",
            refresh_token: "refresh_stale",
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const refreshedAccessToken = createJwt({
      "https://api.openai.com/auth": {
        chatgpt_account_id: "acct_live",
      },
      exp: 2_100_000_000,
    });
    setPiCodexAuthTestOverrides({
      refresh: async (refreshToken) => {
        expect(refreshToken).toBe("refresh_stale");
        return {
          access: refreshedAccessToken,
          accountId: "acct_live",
          expires: 2_100_000_000_000,
          refresh: "refresh_live",
        };
      },
    });

    const refreshResult = await procedures.refreshProviderAuthProcedure({
      providerId: "openai-codex",
    });

    expect(refreshResult.provider).toEqual(
      expect.objectContaining({
        accountId: "acct_live",
        configured: true,
        credentialExpiresAt: "2036-07-18T13:20:00.000Z",
        lastError: null,
        source: "codex-file",
      }),
    );

    const codexAuth = JSON.parse(
      readFileSync(join(codexHome, "auth.json"), "utf8"),
    ) as {
      tokens: {
        access_token: string;
        account_id: string;
        refresh_token: string;
      };
    };
    expect(codexAuth.tokens).toEqual({
      access_token: refreshedAccessToken,
      account_id: "acct_live",
      refresh_token: "refresh_live",
    });

    const piAuth = JSON.parse(
      readFileSync(join(appDataDir, "pi-agent", "auth.json"), "utf8"),
    ) as {
      "openai-codex": {
        access: string;
        accountId: string;
        expires: number;
        refresh: string;
        type: string;
      };
    };
    expect(piAuth["openai-codex"]).toEqual({
      access: refreshedAccessToken,
      accountId: "acct_live",
      expires: 2_100_000_000_000,
      refresh: "refresh_live",
      type: "oauth",
    });
  });
});
