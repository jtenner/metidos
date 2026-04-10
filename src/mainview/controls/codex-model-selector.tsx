/**
 * @file src/mainview/controls/codex-model-selector.tsx
 * @description Module for codex model selector.
 */

import { type JSX, useEffect, useMemo, useRef, useState } from "react";
import type {
  RpcModelOption,
  RpcReasoningEffort,
  RpcReasoningEffortOption,
} from "../../bun/rpc-schema";
import {
  codexModelIdentityLabel,
  codexModelLabel,
  codexModelSelectionOutcome,
  codexModelSelectorLabel,
  codexModelSupportsThinkingLevel,
  codexProviderScopeInfo,
  filterCodexProviderGroups,
  filterCodexProviderModels,
  findCodexModel,
  groupCodexProviders,
} from "./codex-utils";
import { DropdownControl } from "./dropdown";
import { materialSymbol } from "./icons";
import { normalizeSearchQuery } from "./search-utils";

type CodexModelSelectorProps = {
  appTitle?: string;
  disabled: boolean;
  models: RpcModelOption[];
  onChange: (value: string) => void;
  onChangeReasoningEffort?: (value: RpcReasoningEffort) => void;
  reasoningDisabled?: boolean;
  reasoningOptions?: RpcReasoningEffortOption[];
  reasoningValue?: RpcReasoningEffort;
  value: string;
  variant: "desktop" | "mobile";
};

type SelectorStep = "provider" | "model" | "reasoning";

/**
 * Model picker used by chat and cron controls.
 * Guides selection through explicit provider, model, and optional thinking-level steps.
 */
export function CodexModelSelector({
  appTitle = "Jolt",
  disabled,
  models,
  onChange,
  onChangeReasoningEffort,
  reasoningDisabled = false,
  reasoningOptions = [],
  reasoningValue,
  value,
  variant,
}: CodexModelSelectorProps): JSX.Element {
  const providerGroups = useMemo(() => groupCodexProviders(models), [models]);
  const providerGroupById = useMemo(
    () =>
      new Map(
        providerGroups.map(
          (provider) => [provider.providerId, provider] as const,
        ),
      ),
    [providerGroups],
  );
  const modelById = useMemo(
    () => new Map(models.map((model) => [model.id, model] as const)),
    [models],
  );
  const reasoningOptionById = useMemo(
    () =>
      new Map(reasoningOptions.map((option) => [option.id, option] as const)),
    [reasoningOptions],
  );
  const activeModel = useMemo(
    () => findCodexModel(models, value),
    [models, value],
  );
  const activeModelId = activeModel?.id ?? value;
  const activeProvider = activeModel
    ? (providerGroupById.get(activeModel.providerId) ??
      providerGroups[0] ??
      null)
    : (providerGroups[0] ?? null);
  const activeReasoningOption =
    reasoningValue == null
      ? null
      : (reasoningOptionById.get(reasoningValue) ?? null);
  const activeModelSupportsThinking =
    codexModelSupportsThinkingLevel(activeModel);
  const integratedReasoningEnabled =
    onChangeReasoningEffort != null &&
    reasoningValue != null &&
    reasoningOptions.length > 0;
  const reasoningStepBlocked =
    integratedReasoningEnabled &&
    reasoningDisabled &&
    activeModelSupportsThinking;
  const controlDisabled = disabled || reasoningStepBlocked;

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectorStep, setSelectorStep] = useState<SelectorStep>("provider");
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(
    activeProvider?.providerId ?? null,
  );
  const [pendingModelId, setPendingModelId] = useState<string | null>(
    activeModel?.id ?? null,
  );
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (dropdownOpen) {
      return;
    }
    setSearchQuery("");
    setSelectorStep("provider");
    setSelectedProviderId(
      activeProvider?.providerId ?? providerGroups[0]?.providerId ?? null,
    );
    setPendingModelId(activeModel?.id ?? null);
  }, [
    activeModel?.id,
    activeProvider?.providerId,
    dropdownOpen,
    providerGroups,
  ]);

  useEffect(() => {
    if (!dropdownOpen) {
      return;
    }
    searchInputRef.current?.focus();
  }, [dropdownOpen]);

  const selectedProvider = selectedProviderId
    ? (providerGroupById.get(selectedProviderId) ?? activeProvider)
    : activeProvider;
  const pendingModel = pendingModelId
    ? (modelById.get(pendingModelId) ?? activeModel)
    : activeModel;
  const normalizedSearchQuery = normalizeSearchQuery(searchQuery);
  const filteredProviders = useMemo(
    () => filterCodexProviderGroups(providerGroups, normalizedSearchQuery),
    [normalizedSearchQuery, providerGroups],
  );
  const filteredModels = useMemo(
    () => filterCodexProviderModels(selectedProvider, normalizedSearchQuery),
    [normalizedSearchQuery, selectedProvider],
  );
  const selectedProviderScope = codexProviderScopeInfo(
    selectedProvider?.providerId ?? null,
  );
  const selectedProviderAvailable = selectedProvider?.providerAvailable ?? true;
  const selectedProviderAvailabilityNote =
    selectedProvider?.providerAvailabilityNote ?? null;

  const buttonLabel = activeModel
    ? (activeProvider?.providerLabel ?? codexModelSelectorLabel(activeModel))
    : models.length === 0
      ? "Loading models"
      : "Select provider and model";
  const buttonDetail = activeModel
    ? [
        activeModel.label,
        activeModelSupportsThinking && activeReasoningOption
          ? `${activeReasoningOption.label} thinking`
          : null,
      ]
        .filter((value): value is string => Boolean(value))
        .join(" · ")
    : null;
  const dropdownTitle = activeModel
    ? buttonDetail
      ? `${buttonLabel}. ${buttonDetail}. ${activeModel.summary}`
      : `${buttonLabel}. ${activeModel.summary}`
    : `${appTitle} model`;
  const panelClassName =
    variant === "desktop"
      ? "absolute left-0 bottom-[calc(100%+0.5rem)] z-40 w-[20rem] overflow-hidden border border-[#3c4c58] bg-[#15191b] shadow-[0_18px_38px_rgba(0,0,0,0.42)]"
      : "absolute left-0 right-0 bottom-[calc(100%+0.5rem)] z-50 overflow-hidden border border-[#445058] bg-[#171b1d] shadow-[0_18px_38px_rgba(0,0,0,0.42)]";

  function resetSearchForNextStep(nextStep: SelectorStep): void {
    setSearchQuery("");
    setSelectorStep(nextStep);
  }

  function handleProviderSelect(providerId: string): void {
    setSelectedProviderId(providerId);
    resetSearchForNextStep("model");
  }

  function commitModelAndClose(model: RpcModelOption, close: () => void): void {
    close();
    if (model.id !== activeModelId) {
      onChange(model.id);
    }
  }

  function handleModelSelect(model: RpcModelOption, close: () => void): void {
    setPendingModelId(model.id);
    if (
      codexModelSelectionOutcome(model, integratedReasoningEnabled) ===
      "reasoning"
    ) {
      resetSearchForNextStep("reasoning");
      return;
    }
    commitModelAndClose(model, close);
  }

  function handleReasoningSelect(
    nextReasoningEffort: RpcReasoningEffort,
    close: () => void,
  ): void {
    close();
    if (pendingModel && pendingModel.id !== activeModelId) {
      onChange(pendingModel.id);
    }
    if (onChangeReasoningEffort && reasoningValue !== nextReasoningEffort) {
      onChangeReasoningEffort(nextReasoningEffort);
    }
  }

  function handleStepBack(): void {
    setSearchQuery("");
    setSelectorStep((currentStep) =>
      currentStep === "reasoning" ? "model" : "provider",
    );
  }

  return (
    <DropdownControl
      canOpen={!controlDisabled}
      disabled={controlDisabled}
      onOpenChange={setDropdownOpen}
      title={dropdownTitle}
      renderButton={({ open, toggle }) => (
        <button
          type="button"
          className={`flex w-full items-center overflow-hidden border text-left transition-colors ${
            variant === "desktop"
              ? "h-7 gap-2 border-[#3a3a44] bg-[#131313] px-2.5 hover:bg-[#191c1f]"
              : "h-10 gap-2 border-[#424e57] bg-[#1d2022] px-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] hover:bg-[#262b2f]"
          } ${controlDisabled ? "cursor-not-allowed opacity-60" : ""} ${
            open
              ? "border-[#9fc1da] shadow-[0_0_0_1px_rgba(159,193,218,0.18)]"
              : ""
          }`}
          onClick={toggle}
          disabled={controlDisabled}
          aria-expanded={open}
          aria-haspopup="menu"
        >
          <span className="min-w-0 flex-1 overflow-hidden">
            <span
              className={`block truncate font-label font-bold uppercase text-[#f2f0ef] ${
                variant === "desktop"
                  ? "text-[10px] leading-none tracking-wider"
                  : "text-[10px] leading-none tracking-widest"
              }`}
            >
              {buttonLabel}
            </span>
            {buttonDetail ? (
              <span
                className={`block truncate text-[#8ea0ad] ${
                  variant === "desktop"
                    ? "pt-0.5 text-[9px] leading-none"
                    : "pt-1 text-[10px] leading-none"
                }`}
              >
                {buttonDetail}
              </span>
            ) : null}
          </span>
          <span
            className={`shrink-0 text-[#8f8d8b] ${
              variant === "desktop"
                ? "leading-none"
                : "flex h-4 items-center leading-none"
            }`}
          >
            {materialSymbol(
              open ? "expand_less" : "expand_more",
              variant === "desktop" ? "text-[13px]" : "text-[16px]",
            )}
          </span>
        </button>
      )}
      renderPanel={({ close }) => (
        <div className={panelClassName}>
          <div className="border-b border-[#3c4c58] px-3 py-3">
            {selectorStep === "provider" ? null : (
              <div className="flex items-start gap-2">
                <button
                  type="button"
                  className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center text-[#97b5ca] transition-colors hover:bg-[#1e2428] hover:text-[#f2f0ef]"
                  onClick={handleStepBack}
                  aria-label="Back to previous selector step"
                >
                  {materialSymbol("arrow_forward", "text-[16px] rotate-180")}
                </button>
              </div>
            )}
            {selectorStep === "reasoning" ? null : (
              <div
                className={`flex items-center gap-2.5 border border-[#3c4c58] bg-[#111213] px-3 py-2 ${
                  selectorStep === "provider" ? "" : "mt-3"
                }`}
              >
                {materialSymbol("search", "text-[15px] text-[#98b9d0]")}
                <input
                  ref={searchInputRef}
                  className="min-w-0 flex-1 bg-transparent text-[11px] text-[#f2f0ef] outline-none placeholder:text-[#727e86]"
                  placeholder={
                    selectorStep === "provider"
                      ? "Search providers or models"
                      : "Search models"
                  }
                  value={searchQuery}
                  onChange={(event) => {
                    setSearchQuery(event.currentTarget.value);
                  }}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                  }}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                />
                {searchQuery ? (
                  <button
                    type="button"
                    className="flex h-5 w-5 items-center justify-center text-[#8f8d8b] transition-colors hover:bg-[#1d2226] hover:text-[#f2f0ef]"
                    onClick={() => {
                      setSearchQuery("");
                      searchInputRef.current?.focus();
                    }}
                    aria-label="Clear selector search"
                  >
                    ×
                  </button>
                ) : null}
              </div>
            )}
            {selectedProviderScope ? (
              <div className="mt-3 rounded-xl border border-[#31414d] bg-[#101416] px-3 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-[#45606f] bg-[#132129] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-[#d7ebfb]">
                    {selectedProviderScope.badge}
                  </span>
                  <span className="font-label text-[10px] font-bold uppercase tracking-[0.16em] text-[#f4f8fb]">
                    {`Provider: ${selectedProvider?.providerLabel ?? "Unknown"}`}
                  </span>
                  <span className="text-[10px] font-medium text-[#c0d3df]">
                    {selectedProviderScope.summary}
                  </span>
                </div>
                <div className="mt-2 text-[11px] leading-4 text-[#9cb5c6]">
                  {selectedProviderScope.detail}
                </div>
                {!selectedProviderAvailable &&
                selectedProviderAvailabilityNote ? (
                  <div className="mt-2 text-[11px] leading-4 text-[#e9c28c]">
                    {selectedProviderAvailabilityNote}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="max-h-80 overflow-y-auto py-2 hide-scrollbar">
            {selectorStep === "provider" ? (
              filteredProviders.length === 0 ? (
                <div className="px-4 py-4 text-xs text-[#8f9aa2]">
                  No matching providers.
                </div>
              ) : (
                filteredProviders.map((provider) => {
                  const selected =
                    provider.providerId === activeProvider?.providerId;
                  const scopeInfo = codexProviderScopeInfo(provider.providerId);
                  const providerAvailable = provider.providerAvailable ?? true;
                  return (
                    <button
                      key={provider.providerId}
                      type="button"
                      className={`flex w-full items-start gap-3 px-3 py-3 text-left transition-colors ${
                        providerAvailable
                          ? selected
                            ? "bg-[#28353e] text-[#f8fafc]"
                            : "text-[#ebf3f8] hover:bg-[#1e2428]"
                          : selected
                            ? "bg-[#28353e] text-[#f8fafc]"
                            : "cursor-not-allowed text-[#8a949b] opacity-75"
                      }`}
                      onClick={() => {
                        if (!providerAvailable && !selected) {
                          return;
                        }
                        handleProviderSelect(provider.providerId);
                      }}
                      disabled={!providerAvailable && !selected}
                    >
                      <span
                        className={`mt-0.5 shrink-0 ${
                          selected ? "text-[#bdd5e6]" : "text-[#5e676e]"
                        }`}
                      >
                        {materialSymbol(
                          selected ? "check_circle" : "radio_button_unchecked",
                          "text-[16px]",
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-label text-[10px] font-bold uppercase tracking-wider text-inherit">
                          {provider.providerLabel}
                        </span>
                        <span className="mt-1 block font-mono text-[10px] leading-4 text-[#7ca3bd]">
                          {provider.providerId}
                        </span>
                        <span className="mt-1 block text-[11px] leading-4 text-[#a7b7c2]">
                          {`${provider.models.length} model${provider.models.length === 1 ? "" : "s"} available`}
                        </span>
                        {scopeInfo ? (
                          <>
                            <span className="mt-2 inline-flex rounded-full border border-[#45606f] bg-[#132129] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-[#d7ebfb]">
                              {scopeInfo.badge}
                            </span>
                            <span className="mt-1 block text-[11px] leading-4 text-[#9cb5c6]">
                              {scopeInfo.summary}
                            </span>
                          </>
                        ) : null}
                        {!providerAvailable &&
                        provider.providerAvailabilityNote ? (
                          <span className="mt-2 block text-[11px] leading-4 text-[#e9c28c]">
                            {provider.providerAvailabilityNote}
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-0.5 flex shrink-0 items-center pl-1 text-[#6f8899]">
                        {materialSymbol("chevron_right", "text-[16px]")}
                      </span>
                    </button>
                  );
                })
              )
            ) : selectorStep === "model" ? (
              !selectedProviderAvailable ? (
                <div className="px-4 py-4 text-xs leading-5 text-[#cba26c]">
                  {selectedProviderAvailabilityNote ??
                    "This provider is unavailable until its auth is configured in Settings."}
                </div>
              ) : filteredModels.length === 0 ? (
                <div className="px-4 py-4 text-xs text-[#8f9aa2]">
                  No matching models for this provider.
                </div>
              ) : (
                filteredModels.map((model) => {
                  const selected = model.id === activeModelId;
                  return (
                    <button
                      key={model.id}
                      type="button"
                      className={`flex w-full items-start gap-3 px-3 py-3 text-left transition-colors ${
                        selected
                          ? "bg-[#28353e] text-[#f8fafc]"
                          : "text-[#ebf3f8] hover:bg-[#1e2428]"
                      }`}
                      onClick={() => {
                        handleModelSelect(model, close);
                      }}
                    >
                      <span
                        className={`mt-0.5 shrink-0 ${
                          selected ? "text-[#bdd5e6]" : "text-[#5e676e]"
                        }`}
                      >
                        {materialSymbol(
                          selected ? "check_circle" : "radio_button_unchecked",
                          "text-[16px]",
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-label text-[10px] font-bold uppercase tracking-wider text-inherit">
                          {codexModelLabel(model)}
                        </span>
                        <span
                          className={`mt-1 block font-mono text-[10px] leading-4 ${
                            selected ? "text-[#a8c9df]" : "text-[#7790a2]"
                          }`}
                        >
                          {codexModelIdentityLabel(model)}
                        </span>
                        <span
                          className={`mt-1 block text-[11px] leading-4 ${
                            selected ? "text-[#d5e4ef]" : "text-[#a7b7c2]"
                          }`}
                        >
                          {model.summary}
                        </span>
                      </span>
                      {integratedReasoningEnabled &&
                      codexModelSupportsThinkingLevel(model) ? (
                        <span className="mt-0.5 flex shrink-0 items-center pl-1 text-[#6f8899]">
                          {materialSymbol("chevron_right", "text-[16px]")}
                        </span>
                      ) : null}
                    </button>
                  );
                })
              )
            ) : pendingModel ? (
              reasoningOptions.map((option) => {
                const selected = option.id === reasoningValue;
                return (
                  <button
                    key={option.id}
                    type="button"
                    className={`flex w-full items-center gap-3 px-3 py-3 text-left transition-colors ${
                      selected
                        ? "bg-[#28353e] text-[#f8fafc]"
                        : "text-[#ebf3f8] hover:bg-[#1e2428]"
                    }`}
                    onClick={() => {
                      handleReasoningSelect(option.id, close);
                    }}
                  >
                    <span
                      className={`shrink-0 ${
                        selected ? "text-[#bdd5e6]" : "text-[#5e676e]"
                      }`}
                    >
                      {materialSymbol(
                        selected ? "check_circle" : "radio_button_unchecked",
                        "text-[16px]",
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-label text-[10px] font-bold uppercase tracking-wider text-inherit">
                        {option.label}
                      </span>
                      <span className="mt-1 block text-[11px] leading-4 text-[#a7b7c2]">
                        {`${codexModelLabel(pendingModel)} with ${option.label.toLowerCase()} thinking`}
                      </span>
                    </span>
                  </button>
                );
              })
            ) : (
              <div className="px-4 py-4 text-xs text-[#8f9aa2]">
                Choose a model before selecting a thinking level.
              </div>
            )}
          </div>
        </div>
      )}
    />
  );
}
