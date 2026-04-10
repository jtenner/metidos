/**
 * @file src/mainview/app/settings-panel.tsx
 * @description Module for settings panel.
 */

import {
  type JSX,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import type {
  ProjectProcedures,
  RpcModelCatalog,
  RpcOllamaProviderConfig,
  RpcProviderAuthResult,
  RpcProviderAuthStatus,
  RpcRequestPriority,
} from "../../bun/rpc-schema";
import { DropdownControl } from "../controls/dropdown";
import { materialSymbol } from "../controls/icons";

const OPENAI_CODEX_PROVIDER_ID = "openai-codex";

type ProviderAuthBusyAction = "connect" | "logout";
type ProviderAuthBadgeTone = "connected" | "muted" | "pending" | "warning";

type ProviderAuthBadge = {
  label: string;
  tone: ProviderAuthBadgeTone;
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
      label: "Connecting",
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
  const [ollamaStatusLoading, setOllamaStatusLoading] = useState(false);
  const [panelError, setPanelError] = useState("");
  const [providerAuthResult, setProviderAuthResult] =
    useState<RpcProviderAuthResult | null>(null);
  const [ollamaConfig, setOllamaConfig] =
    useState<RpcOllamaProviderConfig | null>(null);
  const [ollamaUrl, setOllamaUrl] = useState("");
  const [ollamaApiKey, setOllamaApiKey] = useState("");
  const ollamaSaveRequestIdRef = useRef(0);
  const triggerButtonClassName =
    variant === "desktop"
      ? "inline-flex h-9 w-9 items-center justify-center border border-[#31414d] bg-[#12181c] text-[#9da8b1] transition hover:border-[#4f6575] hover:text-[#f2f0ef] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7aa5c4]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#131313] rounded-none"
      : "inline-flex h-9 w-9 items-center justify-center border border-[#31414d] bg-[#101418] text-[#bdd5e6] transition hover:border-[#4f6575] hover:text-[#f2f0ef] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7aa5c4]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0e0e0e] rounded-none";
  const panelWidthClassName =
    variant === "desktop"
      ? "w-[21rem] max-w-[calc(100vw-1rem)]"
      : "w-[min(21rem,calc(100vw-1rem))] max-w-[calc(100vw-1rem)]";
  const actionButtonClassName =
    "inline-flex h-9 items-center justify-center border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] transition disabled:cursor-not-allowed disabled:opacity-50 rounded-none";
  const providerStatus = providerAuthResult?.provider ?? null;
  const badge = providerAuthBadge(providerStatus);
  const loginActive = shouldPollProviderAuth(providerStatus);
  const showDisconnectAction =
    providerStatus?.configured === true || loginActive;
  const surfaceError = panelError || providerStatus?.lastError || "";

  const applyProviderAuthResult = useCallback(
    (result: RpcProviderAuthResult): void => {
      setProviderAuthResult(result);
      onModelCatalogChange(result.modelCatalog);
      setPanelError("");
    },
    [onModelCatalogChange],
  );

  const applyOllamaConfig = useCallback((config: RpcOllamaProviderConfig) => {
    setOllamaConfig(config);
    setOllamaUrl(config.url);
    setOllamaApiKey(config.apiKey);
  }, []);

  const loadProviderAuthStatus = useCallback(
    async (options?: {
      priority?: RpcRequestPriority;
      silent?: boolean;
    }): Promise<RpcProviderAuthResult | null> => {
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
        return result;
      } catch (error) {
        setPanelError(toDisplayError(error));
        return null;
      } finally {
        if (!options?.silent) {
          setStatusLoading(false);
        }
      }
    },
    [applyProviderAuthResult, procedures],
  );

  const loadOllamaProviderConfig = useCallback(
    async (options?: {
      priority?: RpcRequestPriority;
      silent?: boolean;
    }): Promise<RpcOllamaProviderConfig | null> => {
      if (!options?.silent) {
        setOllamaStatusLoading(true);
      }
      try {
        const result = await procedures.getOllamaProviderConfig(undefined, {
          priority: options?.priority ?? "default",
        });
        applyOllamaConfig(result);
        return result;
      } catch (error) {
        console.error("Failed to load Ollama settings", error);
        return null;
      } finally {
        if (!options?.silent) {
          setOllamaStatusLoading(false);
        }
      }
    },
    [applyOllamaConfig, procedures],
  );

  const saveOllamaSettings = useCallback(
    (options?: { priority?: RpcRequestPriority }): void => {
      if (
        ollamaConfig &&
        ollamaUrl.trim() === ollamaConfig.url &&
        ollamaApiKey === ollamaConfig.apiKey
      ) {
        return;
      }

      const requestId = ollamaSaveRequestIdRef.current + 1;
      ollamaSaveRequestIdRef.current = requestId;
      setOllamaStatusLoading(true);

      void procedures
        .saveOllamaProviderConfig(
          {
            apiKey: ollamaApiKey,
            url: ollamaUrl,
          },
          {
            priority: options?.priority ?? "foreground",
          },
        )
        .then((result) => {
          if (requestId !== ollamaSaveRequestIdRef.current) {
            return;
          }
          applyOllamaConfig(result.ollama);
          onModelCatalogChange(result.modelCatalog);
        })
        .catch((error) => {
          if (requestId !== ollamaSaveRequestIdRef.current) {
            return;
          }
          console.error("Failed to save Ollama settings", error);
        })
        .finally(() => {
          if (requestId !== ollamaSaveRequestIdRef.current) {
            return;
          }
          setOllamaStatusLoading(false);
        });
    },
    [
      applyOllamaConfig,
      ollamaApiKey,
      ollamaConfig,
      ollamaUrl,
      onModelCatalogChange,
      procedures,
    ],
  );

  const handleConnect = useCallback((): void => {
    setBusyAction("connect");
    setPanelError("");
    void loadProviderAuthStatus({
      priority: "foreground",
    })
      .then((result) => {
        if (result && !result.provider.configured) {
          setPanelError('Run "codex login", then press "Refresh Status".');
        }
      })
      .finally(() => {
        setBusyAction(null);
      });
  }, [loadProviderAuthStatus]);

  const handleLogout = useCallback((): void => {
    setBusyAction("logout");
    setPanelError("");
    void procedures
      .logoutProviderAuth(
        {
          providerId: OPENAI_CODEX_PROVIDER_ID,
        },
        {
          priority: "foreground",
        },
      )
      .then((result) => {
        applyProviderAuthResult(result);
      })
      .catch((error) => {
        setPanelError(toDisplayError(error));
      })
      .finally(() => {
        setBusyAction(null);
      });
  }, [applyProviderAuthResult, procedures]);

  useEffect(() => {
    if (!open) {
      return;
    }
    void loadProviderAuthStatus({
      priority: "foreground",
    });
    void loadOllamaProviderConfig({
      priority: "foreground",
    });
  }, [loadOllamaProviderConfig, loadProviderAuthStatus, open]);

  useEffect(() => {
    if (!open || !loginActive) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      void loadProviderAuthStatus({
        priority: "background",
        silent: true,
      });
    }, 1500);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [loadProviderAuthStatus, loginActive, open]);

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
          className={`${triggerButtonClassName} ${panelOpen ? "border-[#5e7789] bg-[#1a2228] text-[#f2f0ef]" : ""}`}
          onClick={toggle}
          type="button"
        >
          {materialSymbol("settings", "text-[18px]")}
        </button>
      )}
      renderPanel={({ close }) => (
        <div
          aria-label="Settings"
          className={`absolute right-0 top-full z-[95] mt-3 border border-[#31414d] bg-[#141b20]/95 text-[#f2f0ef] shadow-[0_24px_70px_rgba(0,0,0,0.52)] backdrop-blur-xl ${panelWidthClassName}`}
          id={panelId}
          role="dialog"
        >
          <div className="flex items-center justify-between border-b border-[#27333c] px-4 py-2">
            <div className="font-label text-[10px] uppercase tracking-[0.18em] text-[#8fb5cd]">
              Settings
            </div>
            <button
              aria-label="Close settings"
              className="inline-flex h-8 w-8 items-center justify-center border border-[#46535c] text-[13px] font-semibold text-[#d4dee5] transition hover:border-[#6d7b85] hover:text-white rounded-none"
              onClick={close}
              type="button"
            >
              X
            </button>
          </div>

          <div className="p-4">
            <section>
              <div className="flex items-start justify-between gap-3">
                <div className="text-sm font-semibold text-[#f4f8fb]">
                  OpenAI Codex
                </div>
                <span
                  className={`border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] rounded-none ${providerAuthToneClassName(
                    badge.tone,
                  )}`}
                >
                  {badge.label}
                </span>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  className={`${actionButtonClassName} ${
                    showDisconnectAction
                      ? "border-[#69473b] bg-[#1c1210] text-[#f1d2c2] hover:border-[#9f6b57] hover:text-white"
                      : "border-[#45606f] bg-[#10181d] text-[#d7ebfb] hover:border-[#7aa5c4] hover:text-white"
                  }`}
                  disabled={busyAction !== null || statusLoading}
                  onClick={showDisconnectAction ? handleLogout : handleConnect}
                  type="button"
                >
                  {showDisconnectAction
                    ? busyAction === "logout"
                      ? "Disconnecting..."
                      : "Disconnect"
                    : busyAction === "connect"
                      ? "Connecting..."
                      : "Connect"}
                </button>
                <button
                  className={`${actionButtonClassName} border-[#3d4d57] bg-[#0f1519] text-[#c7d7e2] hover:border-[#6d7b85] hover:text-white`}
                  disabled={busyAction !== null || statusLoading}
                  onClick={() => {
                    void loadProviderAuthStatus({
                      priority: "foreground",
                    });
                  }}
                  type="button"
                >
                  {statusLoading ? "Refreshing..." : "Refresh Status"}
                </button>
              </div>
            </section>

            {surfaceError ? (
              <div className="mt-3 border border-[#6a4b34] bg-[#23170f] px-3 py-3 text-xs leading-5 text-[#f0c7a7]">
                {surfaceError}
              </div>
            ) : null}

            <section className="mt-6 border-t border-[#27333c] pt-4">
              <div className="text-sm font-semibold text-[#f4f8fb]">Ollama</div>
              <label className="mt-3 block">
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#7895a8]">
                  Ollama URL
                </div>
                <input
                  autoCapitalize="none"
                  autoCorrect="off"
                  className="mt-2 h-9 w-full border border-[#31414d] bg-[#0d1114] px-3 text-[12px] text-[#dce9f2] outline-none rounded-none focus:border-[#7aa5c4] focus:ring-2 focus:ring-[#7aa5c4]/25"
                  disabled={ollamaStatusLoading}
                  onBlur={() => {
                    saveOllamaSettings({
                      priority: "foreground",
                    });
                  }}
                  onChange={(event) => {
                    setOllamaUrl(event.currentTarget.value);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.currentTarget.blur();
                    }
                  }}
                  placeholder="http://localhost:11434"
                  spellCheck={false}
                  type="text"
                  value={ollamaUrl}
                />
              </label>
              <label className="mt-3 block">
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#7895a8]">
                  Ollama key
                </div>
                <input
                  autoCapitalize="none"
                  autoCorrect="off"
                  className="mt-2 h-9 w-full border border-[#31414d] bg-[#0d1114] px-3 text-[12px] text-[#dce9f2] outline-none rounded-none focus:border-[#7aa5c4] focus:ring-2 focus:ring-[#7aa5c4]/25"
                  disabled={ollamaStatusLoading}
                  onBlur={() => {
                    saveOllamaSettings({
                      priority: "foreground",
                    });
                  }}
                  onChange={(event) => {
                    setOllamaApiKey(event.currentTarget.value);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.currentTarget.blur();
                    }
                  }}
                  spellCheck={false}
                  type="text"
                  value={ollamaApiKey}
                />
              </label>
            </section>
          </div>
        </div>
      )}
    />
  );
}
