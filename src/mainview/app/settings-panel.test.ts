/**
 * @file src/mainview/app/settings-panel.test.ts
 * @description Focused tests for provider-auth UI helpers in the settings panel.
 */

import { describe, expect, it } from "bun:test";

import type { RpcProviderAuthStatus } from "../../bun/rpc-schema";
import {
  canCompleteProviderAuthLogin,
  providerAuthBadge,
  providerAuthNeedsManualCode,
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
    configured: false,
    credentialExpiresAt: null,
    lastError: null,
    login: null,
    piAuthFilePath: "/tmp/jolt/pi-agent/auth.json",
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
            error: null,
            instructions: "Finish sign-in in the browser.",
            loginId: "login_123",
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
      "Jolt Pi auth fallback",
    );
    expect(providerAuthSourceDescription(piFallbackStatus)).toContain(
      "fell back",
    );
  });

  it("includes operator recovery guidance for missing or unusable Codex auth files", () => {
    expect(
      providerAuthSourceDescription(
        buildProviderAuthStatus({
          sourceReason: "codex_auth_file_missing",
        }),
      ),
    ).toContain("OS keyring storage");

    expect(
      providerAuthSourceDescription(
        buildProviderAuthStatus({
          sourceReason: "codex_auth_file_unusable",
        }),
      ),
    ).toContain("Re-run Codex sign-in");
  });

  it("only polls and accepts manual-code completion while login remains active", () => {
    const pendingLogin = {
      authUrl: "https://auth.example.test",
      error: null,
      instructions: "Finish sign-in in the browser.",
      loginId: "login_123",
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
});
