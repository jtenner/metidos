/**
 * @file src/mainview/app/settings-panel.test.ts
 * @description Focused tests for provider-auth UI helpers in the settings panel.
 */

import { describe, expect, it } from "bun:test";

import type { RpcProviderAuthStatus } from "../../bun/rpc-schema";
import {
  canCompleteProviderAuthLogin,
  providerAuthBadge,
  providerAuthCodexCliStatusLabel,
  providerAuthCredentialStoreLabel,
  providerAuthNeedsManualCode,
  providerAuthRecoverySteps,
  providerAuthSourceDescription,
  providerAuthSourceLabel,
  shouldPollProviderAuth,
} from "./settings-panel";

function buildProviderAuthStatus(
  overrides?: Partial<RpcProviderAuthStatus>,
): RpcProviderAuthStatus {
  return {
    accountId: null,
    codexAuthFilePath: "/tmp/.codex/auth.json",
    codexCliAuthDetail: null,
    codexCliAuthStatus: "not_logged_in",
    codexConfigFilePath: "/tmp/.codex/config.toml",
    codexCredentialStoreMode: null,
    configured: false,
    credentialExpiresAt: null,
    lastError: null,
    login: null,
    piAuthFilePath: "/tmp/metidos/pi-agent/auth.json",
    providerId: "openai-codex",
    providerLabel: "OpenAI Codex",
    source: "none",
    sourceReason: "no_codex_auth_available",
    ...overrides,
  };
}

describe("settings panel provider-auth helpers", () => {
  it("derives connected and in-progress badges from provider auth state", () => {
    expect(
      providerAuthBadge(
        buildProviderAuthStatus({
          configured: true,
        }),
      ),
    ).toEqual({
      label: "Connected",
      tone: "connected",
    });

    expect(
      providerAuthBadge(
        buildProviderAuthStatus({
          login: {
            authUrl: "https://auth.example.test",
            deviceCode: null,
            error: null,
            instructions: "Finish sign-in in the browser.",
            loginId: "login_123",
            mode: "browser",
            progressMessages: [],
            prompt: "Paste the redirect URL.",
            startedAt: "2026-04-09T12:00:00.000Z",
            state: "awaiting_code",
            updatedAt: "2026-04-09T12:00:01.000Z",
          },
        }),
      ),
    ).toEqual({
      label: "Sign-In In Progress",
      tone: "pending",
    });
  });

  it("maps auth sources into user-facing labels and descriptions", () => {
    const codexFileStatus = buildProviderAuthStatus({
      source: "codex-file",
      sourceReason: "synced_from_codex_auth_file",
    });
    expect(providerAuthSourceLabel(codexFileStatus)).toBe("~/.codex/auth.json");
    expect(providerAuthSourceDescription(codexFileStatus)).toContain(
      "Pi auth store",
    );

    const piFallbackStatus = buildProviderAuthStatus({
      source: "pi-auth",
      sourceReason: "codex_auth_file_unusable_fell_back_to_pi_auth",
    });
    expect(providerAuthSourceLabel(piFallbackStatus)).toBe(
      "Metidos Pi auth fallback",
    );
    expect(providerAuthSourceDescription(piFallbackStatus)).toContain(
      "fell back",
    );
  });

  it("maps credential-store modes into user-facing labels", () => {
    expect(
      providerAuthCredentialStoreLabel(
        buildProviderAuthStatus({
          codexCredentialStoreMode: "keyring",
        }),
      ),
    ).toBe("OS keyring");
    expect(
      providerAuthCredentialStoreLabel(
        buildProviderAuthStatus({
          codexCredentialStoreMode: "auto",
        }),
      ),
    ).toBe("Automatic");
    expect(
      providerAuthCredentialStoreLabel(
        buildProviderAuthStatus({
          codexCredentialStoreMode: "file",
        }),
      ),
    ).toBe("File cache");
    expect(providerAuthCredentialStoreLabel(buildProviderAuthStatus())).toBe(
      "Codex default",
    );
  });

  it("maps Codex CLI auth states into user-facing labels", () => {
    expect(
      providerAuthCodexCliStatusLabel(
        buildProviderAuthStatus({
          codexCliAuthStatus: "logged_in_chatgpt",
        }),
      ),
    ).toBe("ChatGPT session detected");
    expect(
      providerAuthCodexCliStatusLabel(
        buildProviderAuthStatus({
          codexCliAuthStatus: "logged_in_api_key",
        }),
      ),
    ).toBe("API key session detected");
    expect(
      providerAuthCodexCliStatusLabel(
        buildProviderAuthStatus({
          codexCliAuthStatus: "not_logged_in",
        }),
      ),
    ).toBe("Not signed in");
  });

  it("includes operator recovery guidance for missing or unusable Codex auth files", () => {
    expect(
      providerAuthSourceDescription(
        buildProviderAuthStatus({
          codexCliAuthStatus: "logged_in_chatgpt",
          codexCredentialStoreMode: "keyring",
          sourceReason: "codex_auth_file_missing",
        }),
      ),
    ).toContain("reports an active ChatGPT login");

    expect(
      providerAuthSourceDescription(
        buildProviderAuthStatus({
          sourceReason: "codex_auth_file_unusable",
        }),
      ),
    ).toContain('Re-run "codex login"');
  });

  it("surfaces keyring-aware recovery guidance when Codex is configured for OS credential storage", () => {
    expect(
      providerAuthRecoverySteps(
        buildProviderAuthStatus({
          codexCliAuthStatus: "logged_in_chatgpt",
          codexCredentialStoreMode: "keyring",
          sourceReason: "codex_auth_file_missing",
        }),
      ),
    ).toEqual([
      expect.objectContaining({
        title: "Existing Codex CLI login detected",
      }),
      expect.objectContaining({
        title: "Current Codex CLI storage mode",
      }),
      expect.objectContaining({
        code: "codex login",
        title: "Create the shared Codex login",
      }),
      expect.objectContaining({
        code: 'cli_auth_credentials_store = "file"',
        title: "Optional shared-file cache",
      }),
      expect.objectContaining({
        code: "codex login --device-auth",
        title: "Headless fallback",
      }),
    ]);
  });

  it("builds keyring and headless recovery steps for missing Codex auth files", () => {
    expect(
      providerAuthRecoverySteps(
        buildProviderAuthStatus({
          sourceReason: "codex_auth_file_missing",
        }),
      ),
    ).toEqual([
      expect.objectContaining({
        code: "codex login",
        title: "Create the shared Codex login",
      }),
      expect.objectContaining({
        code: 'cli_auth_credentials_store = "file"',
        title: "Optional shared-file cache",
      }),
      expect.objectContaining({
        code: "codex login --device-auth",
        title: "Headless fallback",
      }),
    ]);
  });

  it("surfaces shared-cache repair steps when Metidos is using Pi auth fallback", () => {
    const steps = providerAuthRecoverySteps(
      buildProviderAuthStatus({
        codexCliAuthStatus: "logged_in_chatgpt",
        codexCredentialStoreMode: "auto",
        configured: true,
        source: "pi-auth",
        sourceReason: "using_existing_pi_codex_auth",
      }),
    );

    expect(steps).toEqual([
      expect.objectContaining({
        title: "Current fallback state",
      }),
      expect.objectContaining({
        code: 'cli_auth_credentials_store = "file"',
        title: "Optional shared-file cache",
      }),
      expect.objectContaining({
        code: "codex login --device-auth",
        title: "Headless fallback",
      }),
    ]);
  });

  it("omits recovery steps when the shared Codex file is already current", () => {
    expect(
      providerAuthRecoverySteps(
        buildProviderAuthStatus({
          configured: true,
          source: "codex-file",
          sourceReason: "codex_auth_file_already_current",
        }),
      ),
    ).toEqual([]);
  });

  it("only polls and accepts manual-code completion while login remains active", () => {
    const pendingLogin = {
      authUrl: "https://auth.example.test",
      deviceCode: null,
      error: null,
      instructions: "Finish sign-in in the browser.",
      loginId: "login_123",
      mode: "browser" as const,
      progressMessages: [],
      prompt: "Paste the redirect URL.",
      startedAt: "2026-04-09T12:00:00.000Z",
      state: "awaiting_code" as const,
      updatedAt: "2026-04-09T12:00:01.000Z",
    };
    const pendingStatus = buildProviderAuthStatus({
      login: pendingLogin,
    });
    expect(shouldPollProviderAuth(pendingStatus)).toBe(true);
    expect(providerAuthNeedsManualCode(pendingStatus)).toBe(true);
    expect(canCompleteProviderAuthLogin(pendingStatus, "code=abc", null)).toBe(
      true,
    );
    expect(canCompleteProviderAuthLogin(pendingStatus, "   ", null)).toBe(
      false,
    );
    expect(
      canCompleteProviderAuthLogin(pendingStatus, "code=abc", "complete"),
    ).toBe(false);

    const completedStatus = buildProviderAuthStatus({
      configured: true,
      login: {
        ...pendingLogin,
        prompt: null,
        state: "completed",
      },
    });
    expect(shouldPollProviderAuth(completedStatus)).toBe(false);
    expect(providerAuthNeedsManualCode(completedStatus)).toBe(false);
  });

  it("keeps the device-auth flow polling without requiring a manual-code paste", () => {
    const deviceStatus = buildProviderAuthStatus({
      login: {
        authUrl: "https://auth.openai.com/codex/device",
        deviceCode: "ABCD-EFGH",
        error: null,
        instructions:
          "Open the browser link, sign in to ChatGPT, and enter the one-time device code shown below.",
        loginId: "login_device",
        mode: "device",
        progressMessages: [
          "Follow these steps to sign in with ChatGPT using device code authorization:",
        ],
        prompt: null,
        startedAt: "2026-04-09T12:00:00.000Z",
        state: "awaiting_browser",
        updatedAt: "2026-04-09T12:00:01.000Z",
      },
    });

    expect(shouldPollProviderAuth(deviceStatus)).toBe(true);
    expect(providerAuthNeedsManualCode(deviceStatus)).toBe(false);
    expect(canCompleteProviderAuthLogin(deviceStatus, "code=abc", null)).toBe(
      false,
    );
  });
});
