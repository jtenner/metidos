/**
 * @file src/mainview/app/settings-panel.test.ts
 * @description Focused tests for settings-panel auth status helpers.
 */

import { describe, expect, it } from "bun:test";

import type { RpcProviderAuthStatus } from "../../bun/rpc-schema";
import { providerAuthBadge, shouldPollProviderAuth } from "./settings-panel";

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

describe("settings panel auth helpers", () => {
  it("reports loading while status has not been fetched yet", () => {
    expect(providerAuthBadge(null)).toEqual({
      label: "Loading",
      tone: "muted",
    });
  });

  it("reports a connected badge when Codex auth is configured", () => {
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
  });

  it("reports a connecting badge while a login is still active", () => {
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
            prompt: null,
            startedAt: "2026-04-09T12:00:00.000Z",
            state: "awaiting_browser",
            updatedAt: "2026-04-09T12:00:01.000Z",
          },
        }),
      ),
    ).toEqual({
      label: "Connecting",
      tone: "pending",
    });
  });

  it("reports a warning badge when the provider has an error", () => {
    expect(
      providerAuthBadge(
        buildProviderAuthStatus({
          lastError: "Token refresh failed.",
        }),
      ),
    ).toEqual({
      label: "Needs Attention",
      tone: "warning",
    });
  });

  it("reports not connected when no auth is configured", () => {
    expect(providerAuthBadge(buildProviderAuthStatus())).toEqual({
      label: "Not Connected",
      tone: "muted",
    });
  });

  it("only polls while the provider login is still active", () => {
    expect(
      shouldPollProviderAuth(
        buildProviderAuthStatus({
          login: {
            authUrl: "https://auth.example.test",
            deviceCode: null,
            error: null,
            instructions: "Finish sign-in in the browser.",
            loginId: "login_123",
            mode: "browser",
            progressMessages: [],
            prompt: null,
            startedAt: "2026-04-09T12:00:00.000Z",
            state: "awaiting_code",
            updatedAt: "2026-04-09T12:00:01.000Z",
          },
        }),
      ),
    ).toBe(true);

    expect(
      shouldPollProviderAuth(
        buildProviderAuthStatus({
          configured: true,
          login: {
            authUrl: "https://auth.example.test",
            deviceCode: null,
            error: null,
            instructions: "Finished sign-in.",
            loginId: "login_123",
            mode: "browser",
            progressMessages: [],
            prompt: null,
            startedAt: "2026-04-09T12:00:00.000Z",
            state: "completed",
            updatedAt: "2026-04-09T12:00:02.000Z",
          },
        }),
      ),
    ).toBe(false);
  });
});
