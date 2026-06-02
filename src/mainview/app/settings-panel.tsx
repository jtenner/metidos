/**
 * @file src/mainview/app/settings-panel.tsx
 * @description Module for settings panel — modal variant.
 */

import {
  type JSX,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import type {
  ProjectProcedures,
  RpcModelCatalog,
  RpcModelOption,
  RpcPluginAccessGroupOption,
  RpcRequestPriority,
  RpcThreadPermissionDescriptor,
  RpcTimezoneSettings,
  RpcUserRuntimeSettings,
} from "../../bun/rpc-schema";
import { dispatchAuthRequired, resetPinAuth } from "../auth-client";
import { AppButton, IconButton } from "../controls/button";
import { CodexModelSelector } from "../controls/codex-model-selector";
import { ConfirmDialog } from "../controls/confirm-dialog";
import { type AppIconName, materialSymbol } from "../controls/icons";
import { ModalDialogSurface } from "../controls/popover";
import { StatusIcon } from "../controls/status-icon";
import {
  PluginInventorySection,
  UserIngressSourcesSection,
} from "./plugin-administration-panel";
import { usePluginAdministrationController } from "./use-plugin-administration-controller";
import { AuthStepUpDialog } from "./auth-step-up-dialog";

type SettingsPanelProps = {
  active?: boolean;
  availablePluginAccessGroups?: RpcPluginAccessGroupOption[];
  availableThreadPermissionDescriptors?: RpcThreadPermissionDescriptor[];
  codexModels?: RpcModelOption[];
  defaultCodexModel?: string;
  homeDirectory?: string;
  isAdmin: boolean;
  onModelCatalogChange: (modelCatalog: RpcModelCatalog) => void;
  onPluginAccessGroupsChange?: (groups: RpcPluginAccessGroupOption[]) => void;
  procedures: ProjectProcedures;
  supportsTildePath?: boolean;
};

type SettingsPanelTabId = "general" | "plugin";

type SettingsPanelTabItem = {
  iconName: AppIconName;
  id: SettingsPanelTabId;
  label: string;
};

const SINGLE_OPERATOR_ADMIN_SETTINGS_TABS: SettingsPanelTabItem[] = [
  { iconName: "settings", id: "general", label: "General" },
  { iconName: "bolt", id: "plugin", label: "Plugin" },
];

const SINGLE_OPERATOR_SETTINGS_TABS: SettingsPanelTabItem[] = [
  { iconName: "settings", id: "general", label: "General" },
];

export function settingsTabsForRole(isAdmin: boolean): SettingsPanelTabItem[] {
  return isAdmin
    ? SINGLE_OPERATOR_ADMIN_SETTINGS_TABS
    : SINGLE_OPERATOR_SETTINGS_TABS;
}

const TIMEZONE_OPTIONS = (() => {
  const intlWithSupportedValues = Intl as typeof Intl & {
    supportedValuesOf?: (key: "timeZone") => string[];
  };
  const values =
    typeof intlWithSupportedValues.supportedValuesOf === "function"
      ? intlWithSupportedValues.supportedValuesOf("timeZone")
      : [];
  return Array.from(new Set(["UTC", ...values])).sort((left, right) =>
    left.localeCompare(right),
  );
})();

function isValidTimezone(value: string): boolean {
  const normalizedValue = value.trim();
  if (!normalizedValue) {
    return true;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: normalizedValue });
    return true;
  } catch {
    return false;
  }
}

function matchingTimezoneOptions(value: string): string[] {
  const normalizedValue = value.trim().toLowerCase();
  if (!normalizedValue) {
    return TIMEZONE_OPTIONS;
  }
  const startsWithMatches = TIMEZONE_OPTIONS.filter((timezone) =>
    timezone.toLowerCase().startsWith(normalizedValue),
  );
  const containsMatches = TIMEZONE_OPTIONS.filter(
    (timezone) =>
      !timezone.toLowerCase().startsWith(normalizedValue) &&
      timezone.toLowerCase().includes(normalizedValue),
  );
  return [...startsWithMatches, ...containsMatches];
}

function toDisplayError(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error ?? "Unknown error");
}

type TimezoneAutocompleteInputProps = {
  label: string;
  name: string;
  onCommit: (value: string) => void;
  onDraftChange: (value: string) => void;
  placeholder: string;
  value: string;
};

function TimezoneAutocompleteInput({
  label,
  name,
  onCommit,
  onDraftChange,
  placeholder,
  value,
}: TimezoneAutocompleteInputProps): JSX.Element {
  const inputId = useId();
  const listboxId = `${inputId}-options`;
  const [open, setOpen] = useState(false);
  const [activeOptionIndex, setActiveOptionIndex] = useState(0);
  const options = useMemo(() => matchingTimezoneOptions(value), [value]);
  const clampedActiveOptionIndex = Math.min(
    activeOptionIndex,
    Math.max(0, options.length - 1),
  );
  const activeOptionId =
    open && options.length > 0
      ? `${listboxId}-option-${clampedActiveOptionIndex}`
      : undefined;

  const blurCommitTimeoutRef = useRef<number | null>(null);
  const commitValue = useCallback(() => {
    onCommit(value.trim());
    setOpen(false);
  }, [onCommit, value]);
  const commitValueRef = useRef(commitValue);

  useEffect(() => {
    commitValueRef.current = commitValue;
  }, [commitValue]);

  useEffect(() => {
    return () => {
      if (blurCommitTimeoutRef.current !== null) {
        window.clearTimeout(blurCommitTimeoutRef.current);
        blurCommitTimeoutRef.current = null;
      }
    };
  }, []);

  const scheduleBlurCommit = useCallback(() => {
    if (blurCommitTimeoutRef.current !== null) {
      window.clearTimeout(blurCommitTimeoutRef.current);
    }
    blurCommitTimeoutRef.current = window.setTimeout(() => {
      blurCommitTimeoutRef.current = null;
      commitValueRef.current();
    }, 0);
  }, []);

  return (
    <label className="relative block">
      <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-text-faint">
        {label}
      </div>
      <input
        aria-activedescendant={activeOptionId}
        aria-autocomplete="list"
        aria-label={label}
        aria-controls={open && options.length > 0 ? listboxId : undefined}
        aria-expanded={open && options.length > 0}
        autoCapitalize="none"
        autoComplete="off"
        autoCorrect="off"
        className="mt-2 h-8 w-full border border-border-default bg-surface-1 px-2 font-mono text-xs text-text-secondary outline-none focus:border-accent focus:ring-2 focus:ring-accent/25"
        name={name}
        onBlur={scheduleBlurCommit}
        onChange={(event) => {
          onDraftChange(event.currentTarget.value);
          setActiveOptionIndex(0);
          setOpen(true);
        }}
        onFocus={() => {
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && options.length > 0) {
            event.preventDefault();
            setOpen(true);
            setActiveOptionIndex((current) =>
              current < options.length - 1 ? current + 1 : 0,
            );
            return;
          }
          if (event.key === "ArrowUp" && options.length > 0) {
            event.preventDefault();
            setOpen(true);
            setActiveOptionIndex((current) =>
              current > 0 ? current - 1 : options.length - 1,
            );
            return;
          }
          if (event.key === "Enter") {
            event.preventDefault();
            if (open && options[clampedActiveOptionIndex]) {
              onDraftChange(options[clampedActiveOptionIndex]);
              onCommit(options[clampedActiveOptionIndex]);
              setOpen(false);
              return;
            }
            commitValue();
          }
          if (event.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder={placeholder}
        role="combobox"
        spellCheck={false}
        type="text"
        value={value}
      />
      {open && options.length > 0 ? (
        <div
          className="absolute z-50 mt-1 max-h-52 w-full overflow-auto border border-border-default bg-surface-2 py-1 shadow-overlay"
          id={listboxId}
          role="listbox"
        >
          {options.map((option, index) => {
            const selected = option === value.trim();
            const active = index === clampedActiveOptionIndex;
            return (
              <AppButton
                unstyled
                aria-selected={selected}
                className={`block w-full px-2 py-1 text-left font-mono text-xs hover:bg-surface-3 hover:text-text-primary ${
                  active
                    ? "bg-surface-3 text-text-primary"
                    : "text-text-secondary"
                }`}
                id={`${listboxId}-option-${index}`}
                key={option}
                onMouseDown={(event) => {
                  event.preventDefault();
                  onDraftChange(option);
                  onCommit(option);
                  setOpen(false);
                }}
                role="option"
                type="button"
              >
                {option}
              </AppButton>
            );
          })}
        </div>
      ) : null}
    </label>
  );
}

export function SettingsPanelFrame({
  children,
  closeButtonRef,
  descriptionId,
  onClose,
  titleId,
}: {
  children?: ReactNode;
  closeButtonRef?: RefObject<HTMLButtonElement | null> | undefined;
  descriptionId: string;
  onClose: () => void;
  titleId: string;
}): JSX.Element {
  return (
    <>
      <p className="sr-only" id={descriptionId}>
        Workspace, local app, and provider settings.
      </p>
      <div className="flex items-start justify-between gap-3 border-b border-border-subtle bg-surface-2 px-4 py-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center border border-border-default bg-accent-surface text-accent">
            {materialSymbol("settings", "text-[20px]")}
          </div>
          <div className="min-w-0">
            <div
              className="text-base font-semibold leading-5 text-text-primary"
              id={titleId}
            >
              Settings
            </div>
            <div className="mt-1 text-xs leading-5 text-text-muted">
              Configure local app, runtime, and plugin settings.
            </div>
          </div>
        </div>
        <IconButton
          aria-label="Close settings"
          buttonStyle="muted"
          onClick={onClose}
          ref={closeButtonRef}
          type="button"
        >
          {materialSymbol("close", "text-[15px]")}
        </IconButton>
      </div>
      {children}
    </>
  );
}

function ResetPinSection(props: {
  className: string;
  error: string;
  loading: boolean;
  onReset: () => void;
  onResetPinChange: (value: string) => void;
  onResetPinTotpChange: (value: string) => void;
  resetPin: string;
  resetPinInputId: string;
  resetPinTotp: string;
  resetPinTotpInputId: string;
}): JSX.Element {
  return (
    <div className={props.className}>
      <div className="text-sm font-semibold text-text-primary">Reset Pin</div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label
            className="block text-[10px] font-semibold uppercase tracking-[0.1em] text-text-faint"
            htmlFor={props.resetPinInputId}
          >
            New Pin
          </label>
          <input
            id={props.resetPinInputId}
            autoComplete="off"
            className="h-8 w-full min-w-0 border border-border-default bg-surface-1 px-2 font-mono text-xs tracking-[0.12em] text-text-secondary outline-none focus:border-accent focus:ring-2 focus:ring-accent/25"
            disabled={props.loading}
            inputMode="numeric"
            onChange={(event) => {
              props.onResetPinChange(
                event.currentTarget.value.replace(/\D+/g, ""),
              );
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                props.onReset();
              }
            }}
            placeholder="6+ digit PIN"
            spellCheck={false}
            type="text"
            value={props.resetPin}
          />
        </div>
        <div className="space-y-1">
          <label
            className="block text-[10px] font-semibold uppercase tracking-[0.1em] text-text-faint"
            htmlFor={props.resetPinTotpInputId}
          >
            TOTP
          </label>
          <input
            id={props.resetPinTotpInputId}
            autoComplete="off"
            className="h-8 w-full min-w-0 border border-border-default bg-surface-1 px-2 font-mono text-xs tracking-[0.12em] text-text-secondary outline-none focus:border-accent focus:ring-2 focus:ring-accent/25"
            disabled={props.loading}
            inputMode="numeric"
            onChange={(event) => {
              props.onResetPinTotpChange(
                event.currentTarget.value.replace(/\D+/g, ""),
              );
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                props.onReset();
              }
            }}
            placeholder="6-digit code"
            spellCheck={false}
            type="text"
            value={props.resetPinTotp}
          />
        </div>
      </div>
      <div className="flex justify-end">
        <AppButton
          buttonStyle="muted"
          disabled={props.loading}
          onClick={props.onReset}
          type="button"
        >
          {props.loading ? "Resetting…" : "Reset"}
        </AppButton>
      </div>
      {props.error ? (
        <div className="border border-danger-border bg-danger-surface px-3 py-2 text-xs text-danger-text">
          {props.error}
        </div>
      ) : null}
      <div className="text-[11px] leading-5 text-text-muted">
        Reset the current PIN after confirming a fresh TOTP code. You’ll be
        signed out and need to sign back in with the new PIN.
      </div>
    </div>
  );
}

/**
 * Settings trigger and modal shell for app and workspace preferences.
 */
export function SettingsPanel({
  active = true,
  availablePluginAccessGroups = [],
  availableThreadPermissionDescriptors = [],
  codexModels = [],
  defaultCodexModel = "",
  homeDirectory = "",
  isAdmin,
  onModelCatalogChange,
  onPluginAccessGroupsChange,
  procedures,
  supportsTildePath = false,
}: SettingsPanelProps): JSX.Element {
  const panelId = useId();
  const panelTitleId = `${panelId}-title`;
  const panelDescriptionId = `${panelId}-description`;
  const resetPinInputId = `${panelId}-reset-pin`;
  const resetPinTotpInputId = `${panelId}-reset-pin-totp`;
  const commandTimeoutInputId = `${panelId}-command-timeout`;
  const embeddingModelInputId = `${panelId}-embedding-model`;
  const [open, setOpen] = useState(false);
  const [resetPin, setResetPin] = useState("");
  const [resetPinError, setResetPinError] = useState("");
  const [resetPinLoading, setResetPinLoading] = useState(false);
  const [resetPinTotp, setResetPinTotp] = useState("");
  const [timezoneSettings, setTimezoneSettings] =
    useState<RpcTimezoneSettings | null>(null);
  const [runtimeSettings, setRuntimeSettings] =
    useState<RpcUserRuntimeSettings | null>(null);
  const [timezone, setTimezone] = useState("");
  const [commandTimeoutMinutes, setCommandTimeoutMinutes] = useState("");
  const [timezoneSaveStatus, setTimezoneSaveStatus] = useState("");
  const [runtimeSaveStatus, setRuntimeSaveStatus] = useState("");
  const [selectedSettingsTab, setSelectedSettingsTab] =
    useState<SettingsPanelTabId>("general");
  const settingsCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const timezoneLoadRequestIdRef = useRef(0);
  const runtimeLoadRequestIdRef = useRef(0);
  const pluginAdministration = usePluginAdministrationController({
    active,
    availablePluginAccessGroups,
    availableThreadPermissionDescriptors,
    codexModels,
    defaultCodexModel,
    homeDirectory,
    isAdmin,
    onModelCatalogChange,
    onPluginAccessGroupsChange,
    open,
    procedures,
    supportsTildePath,
  });

  const applyTimezoneSettings = useCallback((settings: RpcTimezoneSettings) => {
    setTimezoneSettings(settings);
    setTimezone(settings.timezone);
  }, []);

  const applyRuntimeSettings = useCallback(
    (settings: RpcUserRuntimeSettings) => {
      setRuntimeSettings(settings);
      setCommandTimeoutMinutes(String(settings.commandTimeoutSeconds / 60));
    },
    [],
  );

  const loadTimezoneSettings = useCallback(
    async (options?: { priority?: RpcRequestPriority }): Promise<void> => {
      const requestId = ++timezoneLoadRequestIdRef.current;
      try {
        const result = await procedures.getTimezoneSettings(undefined, {
          priority: options?.priority ?? "default",
        });
        if (requestId !== timezoneLoadRequestIdRef.current) {
          return;
        }
        applyTimezoneSettings(result);
        setTimezoneSaveStatus("");
      } catch (error) {
        if (requestId !== timezoneLoadRequestIdRef.current) {
          return;
        }
        setTimezoneSaveStatus(toDisplayError(error));
      }
    },
    [applyTimezoneSettings, procedures],
  );

  const loadRuntimeSettings = useCallback(
    async (options?: { priority?: RpcRequestPriority }): Promise<void> => {
      const requestId = ++runtimeLoadRequestIdRef.current;
      try {
        const result = await procedures.getUserRuntimeSettings(undefined, {
          priority: options?.priority ?? "default",
        });
        if (requestId !== runtimeLoadRequestIdRef.current) {
          return;
        }
        applyRuntimeSettings(result);
        setRuntimeSaveStatus("");
      } catch (error) {
        if (requestId !== runtimeLoadRequestIdRef.current) {
          return;
        }
        setRuntimeSaveStatus(toDisplayError(error));
      }
    },
    [applyRuntimeSettings, procedures],
  );

  const saveTimezoneSettings = useCallback(
    async (options?: {
      priority?: RpcRequestPriority;
      timezone?: string;
    }): Promise<void> => {
      const nextTimezone = options?.timezone ?? timezone;
      if (
        timezoneSettings &&
        nextTimezone.trim() === timezoneSettings.timezone
      ) {
        return;
      }
      setTimezoneSaveStatus("Saving...");
      try {
        const result = await procedures.updateTimezoneSettings(
          { timezone: nextTimezone },
          { priority: options?.priority ?? "foreground" },
        );
        applyTimezoneSettings(result);
        setTimezoneSaveStatus("Saved");
      } catch (error) {
        setTimezoneSaveStatus(toDisplayError(error));
      }
    },
    [applyTimezoneSettings, procedures, timezone, timezoneSettings],
  );

  const commitCommandTimeoutDraft = useCallback(
    (value: string): void => {
      const timeoutMinutes = Number(value.trim());
      if (!Number.isFinite(timeoutMinutes) || timeoutMinutes <= 0) {
        setRuntimeSaveStatus("Command timeout must be greater than 0 minutes.");
        setCommandTimeoutMinutes(
          runtimeSettings
            ? String(runtimeSettings.commandTimeoutSeconds / 60)
            : "10",
        );
        return;
      }
      const commandTimeoutSeconds = Math.max(
        1,
        Math.round(timeoutMinutes * 60),
      );
      if (
        runtimeSettings &&
        commandTimeoutSeconds === runtimeSettings.commandTimeoutSeconds
      ) {
        setCommandTimeoutMinutes(String(timeoutMinutes));
        return;
      }
      setRuntimeSaveStatus("Saving...");
      void procedures
        .updateUserRuntimeSettings(
          { commandTimeoutSeconds },
          { priority: "foreground" },
        )
        .then((result) => {
          applyRuntimeSettings(result);
          setRuntimeSaveStatus("Saved");
        })
        .catch((error) => {
          setRuntimeSaveStatus(toDisplayError(error));
        });
    },
    [applyRuntimeSettings, procedures, runtimeSettings],
  );

  const embeddingModels = useMemo(
    () =>
      codexModels.filter(
        (model) => model.supportsEmbeddings && !model.isPlaceholder,
      ),
    [codexModels],
  );

  const commitEmbeddingModelDraft = useCallback(
    (model: string): void => {
      if (runtimeSettings && model === runtimeSettings.embeddingModel) {
        return;
      }
      setRuntimeSaveStatus("Saving...");
      void procedures
        .updateUserRuntimeSettings(
          { embeddingModel: model },
          { priority: "foreground" },
        )
        .then((result) => {
          applyRuntimeSettings(result);
          setRuntimeSaveStatus("Saved");
        })
        .catch((error) => {
          setRuntimeSaveStatus(toDisplayError(error));
        });
    },
    [applyRuntimeSettings, procedures, runtimeSettings],
  );

  const commitTimezoneDraft = useCallback(
    (value: string): void => {
      const normalizedValue = value.trim();
      if (!isValidTimezone(normalizedValue)) {
        setTimezoneSaveStatus(`Invalid timezone: ${normalizedValue}`);
        setTimezone(timezoneSettings?.timezone ?? "");
        return;
      }

      setTimezone(normalizedValue);
      void saveTimezoneSettings({
        priority: "foreground",
        timezone: normalizedValue,
      });
    },
    [saveTimezoneSettings, timezoneSettings],
  );

  const handleResetPin = useCallback((): void => {
    if (!resetPin.trim()) {
      setResetPinError("A new PIN is required.");
      return;
    }
    if (!resetPinTotp.trim()) {
      setResetPinError("A TOTP code is required.");
      return;
    }

    setResetPinLoading(true);
    setResetPinError("");
    void resetPinAuth({
      newPin: resetPin,
      totpCode: resetPinTotp,
    })
      .then(() => {
        setResetPin("");
        setResetPinTotp("");
        setOpen(false);
        dispatchAuthRequired(
          "Your PIN was reset. Sign in again with the new PIN.",
        );
      })
      .catch((error) => {
        setResetPinError(toDisplayError(error));
      })
      .finally(() => {
        setResetPinLoading(false);
      });
  }, [resetPin, resetPinTotp]);

  const handleCloseModal = useCallback((restoreFocus?: boolean) => {
    void restoreFocus;
    setOpen(false);
  }, []);

  useEffect(() => {
    if (!active || !open) {
      timezoneLoadRequestIdRef.current += 1;
      runtimeLoadRequestIdRef.current += 1;
      return;
    }
    void loadTimezoneSettings({
      priority: "foreground",
    });
    void loadRuntimeSettings({
      priority: "foreground",
    });
    return () => {
      timezoneLoadRequestIdRef.current += 1;
      runtimeLoadRequestIdRef.current += 1;
    };
  }, [active, loadRuntimeSettings, loadTimezoneSettings, open]);

  useEffect(() => {
    if (!active && open) {
      setOpen(false);
    }
  }, [active, open]);

  useEffect(() => {
    if (!isAdmin && selectedSettingsTab === "plugin") {
      setSelectedSettingsTab("general");
    }
  }, [isAdmin, selectedSettingsTab]);

  const resetPinSection = (
    <ResetPinSection
      className="space-y-2"
      error={resetPinError}
      loading={resetPinLoading}
      onReset={handleResetPin}
      onResetPinChange={setResetPin}
      onResetPinTotpChange={setResetPinTotp}
      resetPin={resetPin}
      resetPinInputId={resetPinInputId}
      resetPinTotp={resetPinTotp}
      resetPinTotpInputId={resetPinTotpInputId}
    />
  );
  const userIngressSection = (
    <UserIngressSourcesSection
      {...pluginAdministration.userIngressSectionProps}
    />
  );
  const settingsTabs = settingsTabsForRole(isAdmin);
  const activeSettingsTab = settingsTabs.some(
    (tab) => tab.id === selectedSettingsTab,
  )
    ? selectedSettingsTab
    : "general";
  const selectedSettingsTabButtonId = `${panelId}-${activeSettingsTab}-tab`;
  const selectedSettingsTabPanelId = `${panelId}-${activeSettingsTab}-panel`;
  const securitySettingsSection = (
    <section className="border-t border-border-subtle pt-3">
      {resetPinSection}
    </section>
  );
  const ingressSettingsSection = userIngressSection;
  const generalSettingsSection = (
    <div className="space-y-4">
      <section>
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-semibold text-text-primary">Time</div>
          <div className="text-[11px] text-text-muted">
            {timezoneSaveStatus}
          </div>
        </div>
        <div className="mt-2 max-w-xs">
          <TimezoneAutocompleteInput
            label="Timezone"
            name="timezone"
            onCommit={commitTimezoneDraft}
            onDraftChange={setTimezone}
            placeholder="System default"
            value={timezone}
          />
        </div>
        <div className="mt-1 text-[11px] leading-5 text-text-muted">
          Effective timezone: {timezoneSettings?.effectiveTimezone ?? "Loading"}
        </div>
      </section>
      <section className="border-t border-border-subtle pt-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-semibold text-text-primary">Runtime</div>
          <div className="text-[11px] text-text-muted">{runtimeSaveStatus}</div>
        </div>
        <div className="mt-2 max-w-xs space-y-1">
          <label
            className="block text-[10px] font-semibold uppercase tracking-[0.1em] text-text-faint"
            htmlFor={commandTimeoutInputId}
          >
            Command timeout (minutes)
          </label>
          <input
            id={commandTimeoutInputId}
            className="h-8 w-full min-w-0 border border-border-default bg-surface-1 px-2 font-mono text-xs text-text-secondary outline-none focus:border-accent focus:ring-2 focus:ring-accent/25"
            inputMode="decimal"
            min="0.0167"
            onBlur={(event) => {
              commitCommandTimeoutDraft(event.currentTarget.value);
            }}
            onChange={(event) => {
              setCommandTimeoutMinutes(event.currentTarget.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.blur();
              }
            }}
            step="1"
            type="number"
            value={commandTimeoutMinutes}
          />
        </div>
        <div className="mt-1 text-[11px] leading-5 text-text-muted">
          Applies to command tool calls when the model does not provide an
          explicit timeout.
        </div>
        <div className="mt-3 max-w-xs space-y-1">
          <label
            className="block text-[10px] font-semibold uppercase tracking-[0.1em] text-text-faint"
            htmlFor={embeddingModelInputId}
          >
            Embedding model
          </label>
          <CodexModelSelector
            disabled={embeddingModels.length === 0}
            models={embeddingModels}
            onChange={(model) => {
              commitEmbeddingModelDraft(model);
              return true;
            }}
            value={
              runtimeSettings?.embeddingModel || embeddingModels[0]?.id || ""
            }
            variant="desktop"
          />
        </div>
        <div className="mt-1 text-[11px] leading-5 text-text-muted">
          Plugins with metidos:can_embed use this model. Only providers from
          plugins with metidos:provides_embeddings are listed.
        </div>
      </section>
      {securitySettingsSection}
    </div>
  );
  const pluginSettingsSection = (
    <div className="space-y-3">
      <PluginInventorySection {...pluginAdministration.inventorySectionProps} />
      {pluginAdministration.settingsStatus ? (
        <div className="border border-warning-border bg-warning-surface px-3 py-2 text-xs text-warning-text">
          {pluginAdministration.settingsStatus}
        </div>
      ) : null}
      {ingressSettingsSection}
    </div>
  );
  const settingsTabContent: Record<SettingsPanelTabId, ReactNode> = {
    general: generalSettingsSection,
    plugin: pluginSettingsSection,
  };

  return (
    <>
      <AppButton
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={open ? "Close settings" : "Open settings"}
        buttonStyle={open ? "secondary" : "muted"}
        className="relative"
        iconOnly
        onClick={() => {
          pluginAdministration.onAcknowledgeAttention();
          setOpen((prev) => !prev);
        }}
      >
        {materialSymbol("settings", "text-[20px]")}
        {pluginAdministration.shouldShowAttentionIndicator ? (
          <StatusIcon
            className="absolute -right-1 -top-1 border border-bg-app"
            tone={pluginAdministration.attentionIndicatorTone}
          />
        ) : null}
      </AppButton>

      <ModalDialogSurface
        aria-labelledby={panelTitleId}
        aria-describedby={panelDescriptionId}
        backdropClassName="absolute inset-0 bg-bg-app/80"
        backdropLabel="Close settings"
        className="relative flex h-[90dvh] w-screen flex-col border border-border-default bg-surface-1 text-text-primary shadow-overlay sm:w-[80vw] sm:max-w-[80vw]"
        initialFocusRef={settingsCloseButtonRef}
        onRequestClose={handleCloseModal}
        open={open}
        overlayClassName="fixed inset-0 z-[100] flex items-center justify-center px-0 py-0 sm:px-4 sm:py-6"
        restoreFocus={true}
      >
        <SettingsPanelFrame
          closeButtonRef={settingsCloseButtonRef}
          descriptionId={panelDescriptionId}
          onClose={() => {
            setOpen(false);
          }}
          titleId={panelTitleId}
        >
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <nav
              aria-label="Settings sections"
              className="w-1/5 min-w-[112px] shrink-0 overflow-y-auto border-r border-border-subtle bg-surface-2 px-2 py-3"
            >
              <div
                aria-orientation="vertical"
                className="flex flex-col gap-1"
                role="tablist"
              >
                {settingsTabs.map((tab) => {
                  const selected = tab.id === activeSettingsTab;
                  return (
                    <AppButton
                      unstyled
                      aria-controls={
                        selected ? selectedSettingsTabPanelId : undefined
                      }
                      aria-selected={selected}
                      className={`flex h-9 w-full min-w-0 items-center gap-2 border-l-2 px-2 text-left text-sm transition-colors ${
                        selected
                          ? "border-accent bg-accent-surface text-accent-strong"
                          : "border-transparent text-text-muted hover:bg-surface-3 hover:text-text-primary"
                      }`}
                      id={`${panelId}-${tab.id}-tab`}
                      key={tab.id}
                      onClick={() => {
                        setSelectedSettingsTab(tab.id);
                      }}
                      role="tab"
                      type="button"
                    >
                      {materialSymbol(tab.iconName, "text-[16px]")}
                      <span className="min-w-0 truncate">{tab.label}</span>
                    </AppButton>
                  );
                })}
              </div>
            </nav>
            <div
              className="min-w-0 flex-1 overflow-y-auto px-4 py-3"
              aria-labelledby={selectedSettingsTabButtonId}
              id={selectedSettingsTabPanelId}
              role="tabpanel"
            >
              {settingsTabContent[activeSettingsTab]}
            </div>
          </div>
        </SettingsPanelFrame>
      </ModalDialogSurface>
      <AuthStepUpDialog
        actionLabel="Verify and retry"
        error={pluginAdministration.stepUp.error}
        loading={pluginAdministration.stepUp.loading}
        onCancel={pluginAdministration.stepUp.cancel}
        onPrimaryFactorChange={
          pluginAdministration.stepUp.onPrimaryFactorChange
        }
        onSubmit={pluginAdministration.stepUp.onSubmit}
        onTotpCodeChange={pluginAdministration.stepUp.onTotpCodeChange}
        open={pluginAdministration.stepUp.open}
        primaryFactor={pluginAdministration.stepUp.primaryFactor}
        title="Step-up required"
        totpCode={pluginAdministration.stepUp.totpCode}
      />
      <ConfirmDialog
        confirmLabel="Remove"
        details={pluginAdministration.deleteBindingDialog.details}
        message={pluginAdministration.deleteBindingDialog.message}
        onCancel={pluginAdministration.deleteBindingDialog.onCancel}
        onConfirm={pluginAdministration.deleteBindingDialog.onConfirm}
        open={pluginAdministration.deleteBindingDialog.open}
        title="Remove Binding"
      />
    </>
  );
}
