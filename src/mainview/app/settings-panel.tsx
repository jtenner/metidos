/**
 * @file src/mainview/app/settings-panel.tsx
 * @description Module for settings panel.
 */

import { type JSX, useCallback, useEffect, useId, useState } from "react";

import type {
  ProjectProcedures,
  RpcModelCatalog,
  RpcProviderAuthResult,
  RpcProviderAuthStatus,
  RpcRequestPriority,
} from "../../bun/rpc-schema";
import { DropdownControl } from "../controls/dropdown";
import { materialSymbol } from "../controls/icons";

const OPENAI_CODEX_PROVIDER_ID = "openai-codex";
const PROVIDER_AUTH_STATUS_POLL_INTERVAL_MS = 1_500;

export type ProviderAuthBusyAction =
  | "complete"
  | "load"
  | "login"
  | "logout"
  | "refresh";

type ProviderAuthBadgeTone = "connected" | "muted" | "pending" | "warning";

type ProviderAuthBadge = {
  label: string;
  tone: ProviderAuthBadgeTone;
};

export type ProviderAuthRecoveryStep = {
  body: string;
  code?: string;
  title: string;
};

type SettingsPanelProps = {
  onModelCatalogChange: (modelCatalog: RpcModelCatalog) => void;
  procedures: ProjectProcedures;
  variant: "desktop" | "mobile";
};

/**
 * True when provider auth should be re-polled because login is still active.
 */
export function shouldPollProviderAuth(
  status: RpcProviderAuthStatus | null,
): boolean {
  const loginState = status?.login?.state;
  return (
    loginState === "awaiting_browser" ||
    loginState === "awaiting_code" ||
    loginState === "completing"
  );
}

/**
 * Whether the current provider-auth state expects pasted manual code.
 */
export function providerAuthNeedsManualCode(
  status: RpcProviderAuthStatus | null,
): boolean {
  if (!status?.login?.prompt) {
    return false;
  }
  return (
    status.login.state === "awaiting_browser" ||
    status.login.state === "awaiting_code"
  );
}

/**
 * Whether the manual-code completion action can be submitted.
 */
export function canCompleteProviderAuthLogin(
  status: RpcProviderAuthStatus | null,
  manualCode: string,
  busyAction: ProviderAuthBusyAction | null,
): boolean {
  return (
    providerAuthNeedsManualCode(status) &&
    busyAction !== "complete" &&
    manualCode.trim().length > 0
  );
}

/**
 * User-facing label for the provider-auth source.
 */
export function providerAuthSourceLabel(
  status: Pick<RpcProviderAuthStatus, "source">,
): string {
  switch (status.source) {
    case "codex-file":
      return "~/.codex/auth.json";
    case "pi-auth":
      return "Jolt Pi auth fallback";
    default:
      return "No active Codex auth";
  }
}

/**
 * User-facing label for the Codex CLI credential storage mode.
 */
export function providerAuthCredentialStoreLabel(
  status: Pick<RpcProviderAuthStatus, "codexCredentialStoreMode">,
): string {
  switch (status.codexCredentialStoreMode) {
    case "file":
      return "File cache";
    case "keyring":
      return "OS keyring";
    case "auto":
      return "Automatic";
    default:
      return "Codex default";
  }
}

/**
 * User-facing explanation for the effective provider-auth source/reason.
 */
export function providerAuthSourceDescription(
  status: Pick<
    RpcProviderAuthStatus,
    "codexCredentialStoreMode" | "source" | "sourceReason"
  >,
): string {
  switch (status.sourceReason) {
    case "codex_auth_file_already_current":
      return "Jolt is using the same Codex credentials already stored in ~/.codex/auth.json.";
    case "synced_from_codex_auth_file":
      return "Jolt imported the current Codex file credentials into its Pi auth store so Pi sessions can reuse them.";
    case "using_existing_pi_codex_auth":
      return status.codexCredentialStoreMode === "keyring"
        ? "Jolt is using its Pi auth fallback because Codex CLI is configured for OS keyring storage, so no shared ~/.codex/auth.json cache is expected."
        : status.codexCredentialStoreMode === "auto"
          ? "Jolt is using its Pi auth fallback because Codex CLI is configured for automatic credential storage, which may prefer the OS keyring on this machine."
          : "Jolt is using its Pi auth fallback because no usable Codex file credentials were found.";
    case "codex_auth_file_unusable_fell_back_to_pi_auth":
      return "The Codex auth file exists but could not be used, so Jolt fell back to its Pi auth store instead.";
    case "codex_auth_file_unusable":
      return "The Codex auth file exists but is unreadable or incomplete. Re-run Codex sign-in here to replace it, or remove the broken file and try again.";
    case "codex_auth_file_missing":
      return status.codexCredentialStoreMode === "keyring"
        ? "No ~/.codex/auth.json file was found because Codex CLI is configured for OS keyring storage. Start Codex sign-in here so Jolt can create a Pi-managed fallback, or switch Codex CLI to file storage."
        : status.codexCredentialStoreMode === "auto"
          ? "No ~/.codex/auth.json file was found. Codex CLI is configured for automatic credential storage, which may have chosen the OS keyring on this machine. Start Codex sign-in here so Jolt can create a Pi-managed fallback, or switch Codex CLI to file storage."
          : "No ~/.codex/auth.json file was found. If Codex is using OS keyring storage instead, start Codex sign-in here so Jolt can create a Pi-managed fallback.";
    case "no_codex_auth_available":
      return "No Codex credentials are configured yet.";
    default:
      return status.source === "none"
        ? "No Codex credentials are configured yet."
        : "Jolt is using the current provider-auth source for OpenAI Codex.";
  }
}

/**
 * Provider-auth badge text and tone derived from the current status.
 */
export function providerAuthBadge(
  status: RpcProviderAuthStatus | null,
): ProviderAuthBadge {
  if (!status) {
    return {
      label: "Loading",
      tone: "muted",
    };
  }
  if (shouldPollProviderAuth(status)) {
    return {
      label: "Sign-In In Progress",
      tone: "pending",
    };
  }
  if (status.configured) {
    return {
      label: "Connected",
      tone: "connected",
    };
  }
  if (status.lastError) {
    return {
      label: "Needs Attention",
      tone: "warning",
    };
  }
  return {
    label: "Not Connected",
    tone: "muted",
  };
}

/**
 * Actionable operator guidance for keyring-only, missing-cache, and headless Codex setups.
 */
export function providerAuthRecoverySteps(
  status: Pick<
    RpcProviderAuthStatus,
    | "codexAuthFilePath"
    | "codexConfigFilePath"
    | "codexCredentialStoreMode"
    | "configured"
    | "lastError"
    | "source"
    | "sourceReason"
  > | null,
): ProviderAuthRecoveryStep[] {
  if (!status) {
    return [];
  }

  const sharedCacheBody = `If you want Codex CLI and Jolt to share one cache, set cli_auth_credentials_store = "file" in ${status.codexConfigFilePath}, then sign in again so ${status.codexAuthFilePath} exists.`;
  const headlessBody =
    "For remote or headless hosts, prefer device-code login. If you can complete browser login on another machine, copy the resulting auth.json onto the target host after file-based storage is enabled.";

  switch (status.sourceReason) {
    case "codex_auth_file_missing":
    case "no_codex_auth_available":
      return [
        ...(status.codexCredentialStoreMode === "keyring"
          ? [
              {
                body: `Codex CLI is configured for OS keyring storage in ${status.codexConfigFilePath}, so a shared ${status.codexAuthFilePath} cache is not expected until you switch storage modes.`,
                title: "Current Codex CLI storage mode",
              },
            ]
          : status.codexCredentialStoreMode === "auto"
            ? [
                {
                  body: `Codex CLI is configured for automatic credential storage in ${status.codexConfigFilePath}, so this machine may be using the OS keyring instead of ${status.codexAuthFilePath}.`,
                  title: "Current Codex CLI storage mode",
                },
              ]
            : []),
        {
          body: "Start Codex sign-in here to let Jolt create a Pi-managed fallback even when Codex CLI is using keyring storage.",
          title: "Create a Jolt-managed fallback",
        },
        {
          body: sharedCacheBody,
          code: 'cli_auth_credentials_store = "file"',
          title: "Optional shared-file cache",
        },
        {
          body: headlessBody,
          code: "codex login --device-auth",
          title: "Headless fallback",
        },
      ];
    case "codex_auth_file_unusable":
      return [
        {
          body: `Re-run Codex sign-in here to replace the unusable cache, or remove the broken file at ${status.codexAuthFilePath} before signing in again.`,
          title: "Repair the broken cache",
        },
        {
          body: sharedCacheBody,
          code: 'cli_auth_credentials_store = "file"',
          title: "Rewrite the shared-file cache",
        },
        {
          body: headlessBody,
          code: "codex login --device-auth",
          title: "Headless fallback",
        },
      ];
    case "codex_auth_file_unusable_fell_back_to_pi_auth":
      return [
        {
          body: "Jolt can keep working with its Pi auth fallback, but the Codex CLI cache on disk still needs repair if you want both tools to stay in sync.",
          title: "Current fallback state",
        },
        {
          body: `Re-run Codex sign-in or remove the broken file at ${status.codexAuthFilePath} so Codex CLI can recreate a usable shared cache.`,
          title: "Repair the Codex CLI cache",
        },
        {
          body: headlessBody,
          code: "codex login --device-auth",
          title: "Headless fallback",
        },
      ];
    case "using_existing_pi_codex_auth":
      return [
        {
          body:
            status.codexCredentialStoreMode === "keyring"
              ? `Jolt is already authenticated through its Pi fallback, and Codex CLI is configured for OS keyring storage in ${status.codexConfigFilePath}, so no shared auth.json cache is expected.`
              : status.codexCredentialStoreMode === "auto"
                ? `Jolt is already authenticated through its Pi fallback, and Codex CLI is configured for automatic credential storage in ${status.codexConfigFilePath}, so this machine may still be using the OS keyring.`
                : "Jolt is already authenticated through its Pi fallback, so new Jolt threads can keep running even though Codex CLI is not sharing a file cache.",
          title: "Current fallback state",
        },
        {
          body: sharedCacheBody,
          code: 'cli_auth_credentials_store = "file"',
          title: "Optional shared-file cache",
        },
        {
          body: headlessBody,
          code: "codex login --device-auth",
          title: "Headless fallback",
        },
      ];
    default:
      return status.configured || !status.lastError
        ? []
        : [
            {
              body: "Refresh status first, then retry Codex sign-in here. If the browser callback still fails on a remote host, use device-code login in Codex CLI instead.",
              code: "codex login --device-auth",
              title: "Retry the sign-in flow",
            },
          ];
  }
}

function providerAuthToneClassName(tone: ProviderAuthBadgeTone): string {
  switch (tone) {
    case "connected":
      return "border-[#35684d] bg-[#102217] text-[#9ce2b3]";
    case "pending":
      return "border-[#46627a] bg-[#15222b] text-[#abd0ee]";
    case "warning":
      return "border-[#7a5a2f] bg-[#261b0f] text-[#f1c98a]";
    default:
      return "border-[#365264] bg-[#132129] text-[#8fb5cd]";
  }
}

function formatProviderExpiry(expiresAt: string | null): string | null {
  if (!expiresAt) {
    return null;
  }
  const timestamp = Date.parse(expiresAt);
  if (!Number.isFinite(timestamp)) {
    return null;
  }
  return new Date(timestamp).toLocaleString();
}

function toDisplayError(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error ?? "Unknown error");
}

/**
 * Top-right settings trigger and shell for app and workspace preferences.
 */
export function SettingsPanel({
  onModelCatalogChange,
  procedures,
  variant,
}: SettingsPanelProps): JSX.Element {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);
  const [busyAction, setBusyAction] = useState<ProviderAuthBusyAction | null>(
    null,
  );
  const [manualCode, setManualCode] = useState("");
  const [panelError, setPanelError] = useState("");
  const [providerAuthResult, setProviderAuthResult] =
    useState<RpcProviderAuthResult | null>(null);
  const buttonClassName =
    variant === "desktop"
      ? "rounded-full p-2 text-[#9da8b1] transition hover:bg-[#262626] hover:text-[#f2f0ef] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7aa5c4]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#131313]"
      : "rounded-full p-2 text-[#bdd5e6] transition hover:bg-[#161d21] hover:text-[#f2f0ef] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7aa5c4]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0e0e0e]";
  const panelWidthClassName =
    variant === "desktop"
      ? "w-[24rem] max-w-[calc(100vw-1rem)]"
      : "w-[min(24rem,calc(100vw-1rem))] max-w-[calc(100vw-1rem)]";
  const providerStatus = providerAuthResult?.provider ?? null;
  const badge = providerAuthBadge(providerStatus);
  const providerExpiry = formatProviderExpiry(
    providerStatus?.credentialExpiresAt ?? null,
  );
  const recoverySteps = providerAuthRecoverySteps(providerStatus);

  const applyProviderAuthResult = useCallback(
    (result: RpcProviderAuthResult): void => {
      setProviderAuthResult(result);
      onModelCatalogChange(result.modelCatalog);
      setPanelError("");
      if (!providerAuthNeedsManualCode(result.provider)) {
        setManualCode("");
      }
    },
    [onModelCatalogChange],
  );

  const loadProviderAuthStatus = useCallback(
    async (options?: {
      priority?: RpcRequestPriority;
      silent?: boolean;
    }): Promise<void> => {
      if (!options?.silent) {
        setStatusLoading(true);
      }
      try {
        const result = await procedures.getProviderAuthStatus(
          {
            providerId: OPENAI_CODEX_PROVIDER_ID,
          },
          {
            priority: options?.priority ?? "default",
          },
        );
        applyProviderAuthResult(result);
      } catch (error) {
        setPanelError(toDisplayError(error));
      } finally {
        if (!options?.silent) {
          setStatusLoading(false);
        }
      }
    },
    [applyProviderAuthResult, procedures],
  );

  const runProviderAuthAction = useCallback(
    async (
      action: Exclude<ProviderAuthBusyAction, "load">,
      callback: () => Promise<RpcProviderAuthResult>,
    ): Promise<void> => {
      setBusyAction(action);
      setPanelError("");
      try {
        const result = await callback();
        applyProviderAuthResult(result);
      } catch (error) {
        setPanelError(toDisplayError(error));
      } finally {
        setBusyAction(null);
      }
    },
    [applyProviderAuthResult],
  );

  const handleStartLogin = useCallback((): void => {
    void runProviderAuthAction("login", () =>
      procedures.startProviderAuthLogin(
        {
          providerId: OPENAI_CODEX_PROVIDER_ID,
        },
        {
          priority: "foreground",
        },
      ),
    );
  }, [procedures, runProviderAuthAction]);

  const handleCompleteLogin = useCallback((): void => {
    const loginId = providerAuthResult?.provider.login?.loginId ?? "";
    if (!loginId) {
      return;
    }
    void runProviderAuthAction("complete", () =>
      procedures.completeProviderAuthLogin(
        {
          loginId,
          manualCode,
          providerId: OPENAI_CODEX_PROVIDER_ID,
        },
        {
          priority: "foreground",
        },
      ),
    );
  }, [manualCode, procedures, providerAuthResult, runProviderAuthAction]);

  const handleRefreshAuth = useCallback((): void => {
    void runProviderAuthAction("refresh", () =>
      procedures.refreshProviderAuth(
        {
          providerId: OPENAI_CODEX_PROVIDER_ID,
        },
        {
          priority: "foreground",
        },
      ),
    );
  }, [procedures, runProviderAuthAction]);

  const handleLogout = useCallback((): void => {
    void runProviderAuthAction("logout", () =>
      procedures.logoutProviderAuth(
        {
          providerId: OPENAI_CODEX_PROVIDER_ID,
        },
        {
          priority: "foreground",
        },
      ),
    );
  }, [procedures, runProviderAuthAction]);

  useEffect(() => {
    if (!open) {
      return;
    }
    void loadProviderAuthStatus({
      priority: "foreground",
    });
  }, [loadProviderAuthStatus, open]);

  useEffect(() => {
    if (
      !open ||
      busyAction !== null ||
      !shouldPollProviderAuth(providerStatus)
    ) {
      return;
    }

    const timerId = window.setInterval(() => {
      void loadProviderAuthStatus({
        priority: "background",
        silent: true,
      });
    }, PROVIDER_AUTH_STATUS_POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(timerId);
    };
  }, [busyAction, loadProviderAuthStatus, open, providerStatus]);

  return (
    <DropdownControl
      onOpenChange={setOpen}
      rootClassName="relative"
      renderButton={({ open: panelOpen, toggle }) => (
        <button
          aria-controls={panelId}
          aria-expanded={panelOpen}
          aria-haspopup="dialog"
          aria-label={panelOpen ? "Close settings" : "Open settings"}
          className={`${buttonClassName} ${panelOpen ? "bg-[#1b2328] text-[#f2f0ef]" : ""}`}
          onClick={toggle}
          type="button"
        >
          {materialSymbol("settings", "text-[18px]")}
        </button>
      )}
      renderPanel={({ close }) => (
        <div
          aria-label="Settings"
          className={`absolute right-0 top-full z-[95] mt-3 overflow-hidden rounded-2xl border border-[#31414d] bg-[#141b20]/95 text-[#f2f0ef] shadow-[0_24px_70px_rgba(0,0,0,0.52)] backdrop-blur-xl ${panelWidthClassName}`}
          id={panelId}
          role="dialog"
        >
          <div className="border-b border-[#27333c] bg-[linear-gradient(135deg,#1a232a_0%,#13191d_100%)] px-4 py-4">
            <div className="font-label text-[10px] uppercase tracking-[0.18em] text-[#8fb5cd]">
              Application
            </div>
            <div className="mt-2 flex items-center gap-2 text-sm font-semibold text-[#f4f8fb]">
              {materialSymbol("settings", "text-[15px] text-[#8fb5cd]")}
              <span>Settings</span>
            </div>
            <p className="mt-2 text-xs leading-5 text-[#9fb5c4]">
              Provider auth lives here now. OpenAI Codex is plan-backed through
              ChatGPT auth, while OpenAI API stays a separate API-billed
              provider.
            </p>
          </div>

          <div className="space-y-4 px-4 py-4">
            <section className="space-y-3">
              <div className="font-label text-[10px] uppercase tracking-[0.16em] text-[#7ea2b8]">
                Provider Auth
              </div>

              <div className="rounded-2xl border border-[#2b3943] bg-[#11171b]/85 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-semibold text-[#f4f8fb]">
                      {materialSymbol("bolt", "text-[15px] text-[#8fb5cd]")}
                      <span>OpenAI Codex</span>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-[#9fb5c4]">
                      Use ChatGPT-plan-backed Codex through Pi. This does not
                      replace the separate `OpenAI API` provider in the model
                      selector.
                    </p>
                  </div>

                  <span
                    className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${providerAuthToneClassName(
                      badge.tone,
                    )}`}
                  >
                    {badge.label}
                  </span>
                </div>

                <div className="mt-4 space-y-2 rounded-xl border border-[#22303a] bg-[#0d1418]/80 px-3 py-3 text-xs text-[#c7d7e2]">
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-[#7ea2b8]">Auth source</span>
                    <span className="max-w-[13rem] text-right text-[#f4f8fb]">
                      {providerStatus
                        ? providerAuthSourceLabel(providerStatus)
                        : "Loading..."}
                    </span>
                  </div>
                  <div className="text-[#8fa5b5]">
                    {providerStatus
                      ? providerAuthSourceDescription(providerStatus)
                      : "Reading the active provider-auth source."}
                  </div>
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-[#7ea2b8]">Credential storage</span>
                    <span className="max-w-[13rem] text-right text-[#f4f8fb]">
                      {providerStatus
                        ? providerAuthCredentialStoreLabel(providerStatus)
                        : "Loading..."}
                    </span>
                  </div>
                  {providerExpiry ? (
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-[#7ea2b8]">Expires</span>
                      <span className="max-w-[13rem] text-right text-[#f4f8fb]">
                        {providerExpiry}
                      </span>
                    </div>
                  ) : null}
                  {providerStatus?.accountId ? (
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-[#7ea2b8]">Account</span>
                      <span className="max-w-[13rem] break-all text-right text-[#f4f8fb]">
                        {providerStatus.accountId}
                      </span>
                    </div>
                  ) : null}
                </div>

                {providerStatus?.login &&
                shouldPollProviderAuth(providerStatus) ? (
                  <div className="mt-4 space-y-3 rounded-xl border border-[#324c5d] bg-[#132129]/90 px-3 py-3 text-xs text-[#d9e7f1]">
                    <div className="font-medium text-[#eef7ff]">
                      {providerStatus.login.instructions ??
                        "Open the browser flow, then finish sign-in here if Pi asks for a manual code."}
                    </div>

                    {providerStatus.login.authUrl ? (
                      <a
                        className="inline-flex items-center gap-2 rounded-full border border-[#4c6a7f] px-3 py-1.5 text-[11px] font-semibold text-[#d7ebfb] transition hover:border-[#7aa5c4] hover:text-white"
                        href={providerStatus.login.authUrl}
                        rel="noreferrer"
                        target="_blank"
                      >
                        {materialSymbol("arrow_upward", "text-[14px]")}
                        Continue In Browser
                      </a>
                    ) : null}

                    {providerAuthNeedsManualCode(providerStatus) ? (
                      <label className="block space-y-2">
                        <span className="font-medium text-[#eef7ff]">
                          {providerStatus.login.prompt ??
                            "Paste the authorization code or redirect URL."}
                        </span>
                        <textarea
                          aria-label="Codex authorization code"
                          className="app-scrollbar min-h-[5.5rem] w-full rounded-xl border border-[#3a4b57] bg-[#0f1519] px-3 py-2 text-sm text-[#f4f8fb] placeholder:text-[#6f8797] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7aa5c4]/60"
                          onChange={(event) => {
                            setManualCode(event.target.value);
                          }}
                          placeholder="Paste the authorization code or full redirect URL."
                          value={manualCode}
                        />
                      </label>
                    ) : null}

                    {providerStatus.login.progressMessages.length > 0 ? (
                      <div className="space-y-1 text-[#9fc0d7]">
                        {providerStatus.login.progressMessages.map(
                          (message) => (
                            <div key={message}>{message}</div>
                          ),
                        )}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {providerStatus?.lastError ? (
                  <div className="mt-4 rounded-xl border border-[#6a4b34] bg-[#23170f] px-3 py-2 text-xs leading-5 text-[#f0c7a7]">
                    {providerStatus.lastError}
                  </div>
                ) : null}

                {panelError ? (
                  <div className="mt-4 rounded-xl border border-[#6a4b34] bg-[#23170f] px-3 py-2 text-xs leading-5 text-[#f0c7a7]">
                    {panelError}
                  </div>
                ) : null}

                {recoverySteps.length > 0 ? (
                  <div className="mt-4 space-y-3 rounded-xl border border-[#314454] bg-[#111920]/90 px-3 py-3 text-xs text-[#d4e2eb]">
                    <div>
                      <div className="font-medium text-[#eef7ff]">
                        Recovery Guidance
                      </div>
                      <div className="mt-1 leading-5 text-[#96b0c4]">
                        These steps mirror the current Codex auth guidance for
                        file storage and headless sign-in recovery.
                      </div>
                    </div>

                    <div className="space-y-3">
                      {recoverySteps.map((step, index) => (
                        <div
                          className="rounded-xl border border-[#263744] bg-[#0d1418]/75 px-3 py-3"
                          key={`${step.title}-${step.code ?? step.body}`}
                        >
                          <div className="font-medium text-[#eef7ff]">
                            {index + 1}. {step.title}
                          </div>
                          <div className="mt-1 leading-5 text-[#9fc0d7]">
                            {step.body}
                          </div>
                          {step.code ? (
                            <pre className="mt-2 overflow-x-auto rounded-lg border border-[#334857] bg-[#091015] px-3 py-2 text-[11px] leading-5 text-[#d7ebfb]">
                              <code>{step.code}</code>
                            </pre>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="mt-4 flex flex-wrap gap-2">
                  {!providerStatus?.configured &&
                  !shouldPollProviderAuth(providerStatus) ? (
                    <button
                      className="rounded-full border border-[#45606f] px-3 py-1.5 text-xs font-semibold text-[#d7ebfb] transition hover:border-[#7aa5c4] hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={busyAction !== null || statusLoading}
                      onClick={handleStartLogin}
                      type="button"
                    >
                      {busyAction === "login"
                        ? "Starting Sign-In..."
                        : "Start Codex Sign-In"}
                    </button>
                  ) : null}

                  {providerAuthNeedsManualCode(providerStatus) ? (
                    <button
                      className="rounded-full border border-[#45606f] px-3 py-1.5 text-xs font-semibold text-[#d7ebfb] transition hover:border-[#7aa5c4] hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={
                        !canCompleteProviderAuthLogin(
                          providerStatus,
                          manualCode,
                          busyAction,
                        )
                      }
                      onClick={handleCompleteLogin}
                      type="button"
                    >
                      {busyAction === "complete"
                        ? "Completing..."
                        : "Complete Sign-In"}
                    </button>
                  ) : null}

                  {providerStatus?.configured ? (
                    <>
                      <button
                        className="rounded-full border border-[#45606f] px-3 py-1.5 text-xs font-semibold text-[#d7ebfb] transition hover:border-[#7aa5c4] hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={busyAction !== null || statusLoading}
                        onClick={handleRefreshAuth}
                        type="button"
                      >
                        {busyAction === "refresh"
                          ? "Refreshing..."
                          : "Refresh Auth"}
                      </button>
                      <button
                        className="rounded-full border border-[#69473b] px-3 py-1.5 text-xs font-semibold text-[#f1d2c2] transition hover:border-[#9f6b57] hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={busyAction !== null || statusLoading}
                        onClick={handleLogout}
                        type="button"
                      >
                        {busyAction === "logout"
                          ? "Disconnecting..."
                          : "Disconnect"}
                      </button>
                    </>
                  ) : null}

                  <button
                    className="rounded-full border border-[#3d4d57] px-3 py-1.5 text-xs font-medium text-[#c7d7e2] transition hover:border-[#6d7b85] hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={busyAction !== null}
                    onClick={() => {
                      void loadProviderAuthStatus({
                        priority: "foreground",
                      });
                    }}
                    type="button"
                  >
                    {statusLoading ? "Refreshing Status..." : "Refresh Status"}
                  </button>
                </div>
              </div>
            </section>

            <section className="space-y-3">
              <div className="font-label text-[10px] uppercase tracking-[0.16em] text-[#7ea2b8]">
                Routing Rules
              </div>

              <div className="rounded-2xl border border-[#2b3943] bg-[#11171b]/80 px-3 py-3 text-xs leading-5 text-[#c7d7e2]">
                Provider is selected before model so identical ids such as
                `gpt-5.4` stay unambiguous. `OpenAI Codex` means ChatGPT-plan
                auth through Pi, while `OpenAI API` stays API-billed even if the
                model name looks the same.
              </div>
            </section>
          </div>

          <div className="flex items-center justify-between border-t border-[#27333c] bg-[#11171b]/70 px-4 py-3">
            <div className="text-xs text-[#859aa8]">
              Provider settings update the live model catalog for new thread and
              cron defaults.
            </div>
            <button
              className="rounded-full border border-[#46535c] px-3 py-1.5 text-xs font-medium text-[#d4dee5] transition hover:border-[#6d7b85] hover:text-white"
              onClick={close}
              type="button"
            >
              Close
            </button>
          </div>
        </div>
      )}
    />
  );
}
