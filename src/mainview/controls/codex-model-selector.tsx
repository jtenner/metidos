/**
 * @file src/mainview/controls/codex-model-selector.tsx
 * @description Module for codex model selector.
 */

import { type JSX, useEffect, useId, useMemo, useRef, useState } from "react";
import type {
  RpcModelOption,
  RpcReasoningEffort,
  RpcReasoningEffortOption,
} from "../../bun/rpc-schema";
import { AppButton } from "./button";
import {
  codexModelLabel,
  codexModelSelectionOutcome,
  codexModelSupportsThinkingLevel,
  codexProviderScopeInfo,
  codexReasoningPresentation,
  filterCodexProviderGroups,
  filterCodexProviderModels,
  findCodexModel,
  groupCodexProviders,
} from "./codex-utils";
import { DropdownControl } from "./dropdown";
import { materialSymbol } from "./icons";
import { PopoverSurface } from "./popover";
import { normalizeSearchQuery } from "./search-utils";

type CodexModelSelectorProps = {
  disabled: boolean;
  models: RpcModelOption[];
  onChange: (
    value: string,
  ) => boolean | undefined | Promise<boolean | undefined>;
  onChangeReasoningEffort?: (
    value: RpcReasoningEffort,
  ) => boolean | undefined | Promise<boolean | undefined>;
  onRefresh?: (() => void | Promise<void>) | undefined;
  reasoningDisabled?: boolean;
  reasoningOptions?: RpcReasoningEffortOption[];
  reasoningValue?: RpcReasoningEffort;
  refreshing?: boolean | undefined;
  value: string;
  variant: SelectorVariant;
};

type SelectorVariant = "desktop" | "mobile";
type SelectorStep = "provider" | "model" | "reasoning";
export type CodexModelSelectionPath =
  | "commit"
  | "reasoning-step"
  | "reasoning-submenu";
export type CodexModelClickOutcome = "commit" | "reasoning-step";

type SelectionCommitResult = boolean | undefined | Promise<boolean | undefined>;

const DEFAULT_CLICK_REASONING_EFFORT: RpcReasoningEffort = "medium";

type ProviderWarningPopoverState = {
  note: string;
  reference: HTMLElement;
};

/**
 * Resolve whether a model row should commit immediately, advance into the
 * inline thinking step, or expose the desktop hover submenu.
 */
export function deriveCodexModelSelectionPath({
  integratedReasoningEnabled,
  model,
  reasoningPresentation,
  variant,
}: {
  integratedReasoningEnabled: boolean;
  model: RpcModelOption;
  reasoningPresentation: ReturnType<typeof codexReasoningPresentation>;
  variant: SelectorVariant;
}): CodexModelSelectionPath {
  const selectionOutcome = codexModelSelectionOutcome(
    model,
    integratedReasoningEnabled && reasoningPresentation.options.length > 0,
  );
  if (selectionOutcome === "commit") {
    return "commit";
  }
  return variant === "desktop" ? "reasoning-submenu" : "reasoning-step";
}

/**
 * Resolve what a row click should do. Desktop exposes thinking levels through
 * a hover/focus submenu, so clicking the row commits/closes instead of also
 * rendering the inline thinking step beneath the model list.
 */
export function deriveCodexModelClickOutcome(
  selectionPath: CodexModelSelectionPath,
): CodexModelClickOutcome {
  return selectionPath === "reasoning-step" ? "reasoning-step" : "commit";
}

/**
 * Apply a reasoning-capable model selection in sequence so the model update
 * settles before the optional reasoning-effort update runs.
 */
export async function applyCodexReasoningSelection({
  activeModelId,
  nextReasoningEffort,
  onChange,
  onChangeReasoningEffort,
  pendingModel,
  reasoningValue,
}: {
  activeModelId: string;
  nextReasoningEffort: RpcReasoningEffort;
  onChange: (value: string) => SelectionCommitResult;
  onChangeReasoningEffort:
    | ((value: RpcReasoningEffort) => SelectionCommitResult)
    | undefined;
  pendingModel: RpcModelOption | null | undefined;
  reasoningValue: RpcReasoningEffort | null | undefined;
}): Promise<void> {
  if (pendingModel && pendingModel.id !== activeModelId) {
    const committedModel = await onChange(pendingModel.id);
    if (committedModel === false) {
      return;
    }
  }

  if (onChangeReasoningEffort && reasoningValue !== nextReasoningEffort) {
    await onChangeReasoningEffort(nextReasoningEffort);
  }
}

export function defaultReasoningEffortForModelClick(
  reasoningPresentation: ReturnType<typeof codexReasoningPresentation>,
): RpcReasoningEffort | null {
  return reasoningPresentation.options.some(
    (option) => option.id === DEFAULT_CLICK_REASONING_EFFORT,
  )
    ? DEFAULT_CLICK_REASONING_EFFORT
    : null;
}

type ModelReasoningSubmenuProps = {
  close: () => void;
  model: RpcModelOption;
  onHoverStateChange: (modelId: string | null) => void;
  onModelSelect: (model: RpcModelOption, close: () => void) => void;
  onReasoningSelect: (
    nextReasoningEffort: RpcReasoningEffort,
    model: RpcModelOption,
    close: () => void,
  ) => void;
  reasoningPresentation: ReturnType<typeof codexReasoningPresentation>;
  selectionPath: CodexModelSelectionPath;
  selected: boolean;
};

function ModelReasoningSubmenu({
  close,
  model,
  onHoverStateChange,
  onModelSelect,
  onReasoningSelect,
  reasoningPresentation,
  selectionPath,
  selected,
}: ModelReasoningSubmenuProps): JSX.Element {
  const [submenuOpen, setSubmenuOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const closeTimeoutRef = useRef<number | null>(null);
  const supportsReasoningSubmenu = selectionPath === "reasoning-submenu";

  useEffect(
    () => () => {
      if (closeTimeoutRef.current !== null && typeof window !== "undefined") {
        window.clearTimeout(closeTimeoutRef.current);
      }
    },
    [],
  );

  function cancelScheduledClose(): void {
    if (closeTimeoutRef.current === null || typeof window === "undefined") {
      return;
    }

    window.clearTimeout(closeTimeoutRef.current);
    closeTimeoutRef.current = null;
  }

  function openSubmenu(): void {
    cancelScheduledClose();
    if (!supportsReasoningSubmenu) {
      onHoverStateChange(null);
      return;
    }

    onHoverStateChange(model.id);
    setSubmenuOpen(true);
  }

  function scheduleClose(): void {
    cancelScheduledClose();
    if (!supportsReasoningSubmenu || typeof window === "undefined") {
      onHoverStateChange(null);
      setSubmenuOpen(false);
      return;
    }

    closeTimeoutRef.current = window.setTimeout(() => {
      closeTimeoutRef.current = null;
      onHoverStateChange(null);
      setSubmenuOpen(false);
    }, 80);
  }

  return (
    <>
      <AppButton
        ref={anchorRef}
        aria-expanded={supportsReasoningSubmenu ? submenuOpen : undefined}
        aria-haspopup={supportsReasoningSubmenu ? "dialog" : undefined}
        buttonStyle="muted"
        className={`h-auto min-w-0 justify-start gap-3 border-0 px-3 py-1 text-left font-normal ${
          selected
            ? "bg-surface-3 text-text-primary"
            : "text-text-secondary hover:bg-surface-2"
        } touch-pan-y`}
        data-chooser-option="true"
        fullWidth
        role="option"
        aria-selected={selected}
        onBlur={scheduleClose}
        onClick={() => {
          onModelSelect(model, close);
        }}
        onMouseDown={(event) => {
          event.preventDefault();
        }}
        onFocus={openSubmenu}
        onMouseEnter={openSubmenu}
        onMouseLeave={scheduleClose}
        type="button"
      >
        <span
          aria-hidden="true"
          className={`shrink-0 ${
            selected ? "text-accent-strong" : "text-text-faint"
          }`}
        >
          {materialSymbol(
            selected ? "check_circle" : "radio_button_unchecked",
            "text-[16px]",
          )}
        </span>
        <span className="min-w-0 flex flex-1 items-center gap-1">
          <span className="shrink-0 text-[12px] font-semibold text-text-primary">
            {codexModelLabel(model)}
          </span>
          <span
            className={`min-w-0 truncate text-[12px] ${
              selected ? "text-text-secondary" : "text-text-muted"
            }`}
          >
            {`- ${model.modelId}`}
          </span>
        </span>
        {supportsReasoningSubmenu ? (
          <span
            aria-hidden="true"
            className="flex shrink-0 items-center pl-1 text-text-faint"
          >
            {materialSymbol("chevron_right", "text-[17px]")}
          </span>
        ) : null}
      </AppButton>
      <PopoverSurface
        className="z-[220] min-w-[12rem] border border-border-default bg-surface-1 shadow-overlay"
        data-dropdown-interactive-portal="true"
        hideWhenEscaped={false}
        hideWhenReferenceHidden={false}
        offsetPx={4}
        onMouseEnter={openSubmenu}
        onMouseLeave={scheduleClose}
        open={submenuOpen && supportsReasoningSubmenu}
        placement="right-start"
        reference={anchorRef.current}
        viewportPaddingPx={4}
      >
        <fieldset
          aria-label={`Thinking levels for ${codexModelLabel(model)}`}
          className="min-w-0 border-0 p-0"
        >
          {reasoningPresentation.options.map((option) => {
            const selectedOption =
              option.id === reasoningPresentation.activeValue;
            return (
              <AppButton
                key={option.id}
                aria-pressed={selectedOption}
                buttonStyle="muted"
                className={`h-auto min-w-0 justify-start border-0 px-3 py-2 text-left font-normal ${
                  selectedOption
                    ? "bg-surface-3 text-text-primary"
                    : "text-text-secondary hover:bg-surface-2"
                } touch-pan-y`}
                fullWidth
                onClick={() => {
                  onReasoningSelect(option.id, model, close);
                }}
                onMouseDown={(event) => {
                  event.preventDefault();
                }}
                type="button"
              >
                <span className="block text-[12px] font-semibold text-inherit">
                  {option.label}
                </span>
                <span className="mt-1 block text-[11px] leading-4 text-text-muted">
                  {option.description}
                </span>
              </AppButton>
            );
          })}
        </fieldset>
      </PopoverSurface>
    </>
  );
}

/**
 * Model picker used by chat and cron controls.
 * Guides selection through explicit provider, model, and optional thinking-level steps.
 */
export function CodexModelSelector({
  disabled,
  models,
  onChange,
  onChangeReasoningEffort,
  onRefresh,
  reasoningDisabled = false,
  reasoningOptions = [],
  reasoningValue,
  refreshing = false,
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
  const reasoningPresentationByModelId = useMemo(
    () =>
      new Map(
        models.map((model) => [
          model.id,
          codexReasoningPresentation(model, reasoningOptions, reasoningValue),
        ]),
      ),
    [models, reasoningOptions, reasoningValue],
  );
  const activeReasoningPresentation =
    (activeModel
      ? reasoningPresentationByModelId.get(activeModel.id)
      : undefined) ??
    codexReasoningPresentation(null, reasoningOptions, reasoningValue);
  const activeModelSupportsThinking =
    activeReasoningPresentation.options.length > 0 &&
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
  const [pendingModelId, setPendingModelId] = useState<string | null>(null);
  const [providerWarningPopover, setProviderWarningPopover] =
    useState<ProviderWarningPopoverState | null>(null);
  const panelId = useId();
  const panelTitleId = `${panelId}-title`;
  const providerListboxId = `${panelId}-providers`;
  const modelListboxId = `${panelId}-models`;
  const reasoningListboxId = `${panelId}-reasoning`;
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const selectedReasoningOptionRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (dropdownOpen) {
      return;
    }
    setSearchQuery("");
    setSelectorStep("provider");
    setSelectedProviderId(
      activeProvider?.providerId ?? providerGroups[0]?.providerId ?? null,
    );
    setPendingModelId(null);
    setProviderWarningPopover(null);
  }, [activeProvider?.providerId, dropdownOpen, providerGroups]);

  useEffect(() => {
    if (!dropdownOpen) {
      return;
    }

    const focusTarget =
      selectorStep === "reasoning"
        ? selectedReasoningOptionRef.current
        : searchInputRef.current;
    focusTarget?.focus({ preventScroll: true });
  }, [dropdownOpen, selectorStep]);

  const selectedProvider = selectedProviderId
    ? (providerGroupById.get(selectedProviderId) ?? activeProvider)
    : activeProvider;
  const pendingModel = pendingModelId
    ? (modelById.get(pendingModelId) ?? activeModel)
    : activeModel;
  function reasoningPresentationForModelRow(
    model: RpcModelOption,
  ): ReturnType<typeof codexReasoningPresentation> {
    const presentation =
      reasoningPresentationByModelId.get(model.id) ??
      codexReasoningPresentation(model, reasoningOptions, reasoningValue);
    if (model.id === activeModelId) {
      return presentation;
    }
    const defaultReasoningEffort =
      defaultReasoningEffortForModelClick(presentation);
    return defaultReasoningEffort
      ? codexReasoningPresentation(
          model,
          reasoningOptions,
          defaultReasoningEffort,
        )
      : presentation;
  }

  const pendingReasoningPresentation = pendingModel
    ? reasoningPresentationForModelRow(pendingModel)
    : codexReasoningPresentation(null, reasoningOptions, reasoningValue);
  const normalizedSearchQuery = normalizeSearchQuery(searchQuery);
  const filteredProviders = useMemo(
    () => filterCodexProviderGroups(providerGroups, normalizedSearchQuery),
    [normalizedSearchQuery, providerGroups],
  );
  const filteredModels = useMemo(
    () => filterCodexProviderModels(selectedProvider, normalizedSearchQuery),
    [normalizedSearchQuery, selectedProvider],
  );
  const selectedProviderAvailable = selectedProvider?.providerAvailable ?? true;
  const selectedProviderAvailabilityNote =
    selectedProvider?.providerAvailabilityNote ?? null;
  const activeListboxId =
    selectorStep === "provider"
      ? providerListboxId
      : selectorStep === "model"
        ? modelListboxId
        : reasoningListboxId;

  const buttonProviderLabel = activeProvider?.providerLabel ?? null;
  const buttonModelLabel = activeModel
    ? activeModel.label
    : models.length === 0
      ? "Loading models"
      : "Select provider and model";
  const buttonThinkingLabel =
    activeModel &&
    activeModelSupportsThinking &&
    activeReasoningPresentation.activeOption
      ? activeReasoningPresentation.activeOption.label
      : null;
  const panelClassName =
    variant === "desktop"
      ? "z-[108] w-[24rem] overflow-visible border border-border-default bg-surface-1 shadow-overlay"
      : "z-[108] flex h-[min(24rem,var(--popover-available-height))] w-[min(24rem,calc(100vw-1rem))] flex-col overflow-hidden border border-border-default bg-surface-1 shadow-overlay";
  const listClassName =
    variant === "mobile"
      ? "min-w-0 min-h-0 flex-1 touch-pan-y overflow-y-scroll overscroll-contain border-0 p-0 py-2 app-scrollbar [scrollbar-gutter:stable] [-webkit-overflow-scrolling:touch]"
      : "min-w-0 max-h-80 overflow-y-auto border-0 p-0 py-2 app-scrollbar";

  function resetSearchForNextStep(nextStep: SelectorStep): void {
    setSearchQuery("");
    setSelectorStep(nextStep);
  }

  function handleProviderSelect(providerId: string): void {
    setPendingModelId(null);
    setSelectedProviderId(providerId);
    resetSearchForNextStep("model");
  }

  function commitModelAndClose(model: RpcModelOption, close: () => void): void {
    close();
    const reasoningPresentation =
      reasoningPresentationByModelId.get(model.id) ??
      codexReasoningPresentation(model, reasoningOptions, reasoningValue);
    const defaultReasoningEffort = defaultReasoningEffortForModelClick(
      reasoningPresentation,
    );
    void (async () => {
      if (model.id !== activeModelId) {
        const committedModel = await onChange(model.id);
        if (committedModel === false) {
          return;
        }
      }
      if (
        defaultReasoningEffort &&
        onChangeReasoningEffort &&
        reasoningValue !== defaultReasoningEffort
      ) {
        await onChangeReasoningEffort(defaultReasoningEffort);
      }
    })();
  }

  function handleModelSelect(model: RpcModelOption, close: () => void): void {
    const reasoningPresentation =
      reasoningPresentationByModelId.get(model.id) ??
      codexReasoningPresentation(model, reasoningOptions, reasoningValue);
    const selectionPath = deriveCodexModelSelectionPath({
      integratedReasoningEnabled,
      model,
      reasoningPresentation,
      variant,
    });
    if (deriveCodexModelClickOutcome(selectionPath) === "reasoning-step") {
      setPendingModelId(model.id);
      resetSearchForNextStep("reasoning");
      return;
    }
    setPendingModelId(null);
    commitModelAndClose(model, close);
  }

  function handleReasoningSelect(
    nextReasoningEffort: RpcReasoningEffort,
    close: () => void,
    selectedModel: RpcModelOption | null | undefined = pendingModel,
  ): void {
    close();
    void applyCodexReasoningSelection({
      activeModelId,
      nextReasoningEffort,
      onChange,
      onChangeReasoningEffort,
      pendingModel: selectedModel,
      reasoningValue,
    });
  }

  function handleStepBack(): void {
    setSearchQuery("");
    setPendingModelId(null);
    setSelectorStep((currentStep) =>
      currentStep === "reasoning" ? "model" : "provider",
    );
  }

  function showProviderWarningPopover(
    anchor: HTMLElement,
    note: string | null | undefined,
  ): void {
    const normalizedNote = note?.trim();
    if (!normalizedNote) {
      return;
    }

    setProviderWarningPopover({
      note: normalizedNote,
      reference: anchor,
    });
  }

  function hideProviderWarningPopover(): void {
    setProviderWarningPopover(null);
  }

  function renderSearchField(
    placeholder: string,
    close: () => void,
  ): JSX.Element {
    return (
      <div className="flex items-center gap-3 border border-border-default bg-bg-app-elevated px-3 py-2">
        {materialSymbol("search", "text-[16px] text-accent")}
        <input
          ref={searchInputRef}
          aria-controls={activeListboxId}
          aria-label="Search providers or models"
          className="min-w-0 flex-1 bg-transparent text-[13px] text-text-primary outline-none placeholder:text-text-muted focus-visible:outline focus-visible:outline-1 focus-visible:outline-focus-ring"
          data-chooser-search="true"
          name="model-selector-search"
          placeholder={placeholder}
          value={searchQuery}
          onChange={(event) => {
            setSearchQuery(event.currentTarget.value);
          }}
          onMouseDown={(event) => {
            event.stopPropagation();
          }}
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
          onTouchStart={(event) => {
            event.stopPropagation();
          }}
          onKeyDown={(event) => {
            if (event.key !== "Escape") {
              return;
            }
            event.preventDefault();
            close();
          }}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
        {onRefresh ? (
          <AppButton
            aria-label="Refresh model list"
            buttonStyle="muted"
            className={
              refreshing
                ? "border-transparent text-accent"
                : "border-transparent text-text-muted"
            }
            disabled={refreshing}
            iconOnly
            onClick={() => {
              void onRefresh();
              searchInputRef.current?.focus();
            }}
            title="Refresh model list"
            type="button"
          >
            {materialSymbol(
              "refresh",
              refreshing ? "animate-spin text-[16px]" : "text-[16px]",
            )}
          </AppButton>
        ) : null}
        {searchQuery ? (
          <AppButton
            aria-label="Clear selector search"
            buttonStyle="muted"
            className="border-transparent text-text-muted"
            iconOnly
            onClick={() => {
              setSearchQuery("");
              searchInputRef.current?.focus();
            }}
            type="button"
          >
            {materialSymbol("close", "text-[15px]")}
          </AppButton>
        ) : null}
      </div>
    );
  }

  const panelInitialFocusRef =
    selectorStep === "reasoning" ? selectedReasoningOptionRef : searchInputRef;

  return (
    <>
      <DropdownControl
        canOpen={!controlDisabled}
        disabled={controlDisabled}
        onOpenChange={setDropdownOpen}
        panelClassName={panelClassName}
        panelHideWhenReferenceHidden={variant !== "mobile"}
        panelId={panelId}
        panelInitialFocusRef={panelInitialFocusRef}
        panelLabelledBy={panelTitleId}
        panelMode="chooser"
        panelPlacement="top-start"
        renderButton={({ buttonRef, open, toggle }) => (
          <AppButton
            buttonStyle="muted"
            className={[
              "overflow-hidden text-left",
              open ? "border-focus-ring" : "",
            ].join(" ")}
            fullWidth
            onClick={toggle}
            disabled={controlDisabled}
            aria-controls={panelId}
            aria-expanded={open}
            aria-haspopup="dialog"
            ref={buttonRef}
          >
            <span className="min-w-0 flex flex-1 items-center overflow-hidden">
              {activeModel && buttonProviderLabel ? (
                <>
                  <span className="shrink-0 text-[12px] font-semibold leading-none text-text-primary">
                    {buttonProviderLabel}
                  </span>
                  <span className="min-w-0 truncate pl-2 text-[12px] leading-none text-text-muted">
                    {buttonModelLabel}
                  </span>
                </>
              ) : (
                <span className="truncate text-[12px] leading-none text-text-primary">
                  {buttonModelLabel}
                </span>
              )}
            </span>
            <span className="ml-3 flex shrink-0 items-center gap-2">
              {buttonThinkingLabel ? (
                <span className="inline-flex shrink-0 border border-border-default bg-accent-surface px-2 py-1 uppercase-label text-accent-strong">
                  {buttonThinkingLabel}
                </span>
              ) : null}
              <span
                className={`shrink-0 text-text-muted ${
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
            </span>
          </AppButton>
        )}
        renderPanel={({ close }) => (
          <>
            <div className="sr-only" id={panelTitleId}>
              Choose a model and, when supported, a thinking level.
            </div>
            <div className="shrink-0 border-b border-border-default px-3 py-3">
              {selectorStep === "provider" ? (
                renderSearchField("Search providers or models", close)
              ) : selectedProvider ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <AppButton
                      aria-label="Back to previous selector step"
                      buttonStyle="muted"
                      className="shrink-0 border-transparent text-accent"
                      iconOnly
                      onClick={handleStepBack}
                      type="button"
                    >
                      {materialSymbol(
                        "arrow_forward",
                        "text-[16px] rotate-180",
                      )}
                    </AppButton>
                    <div className="text-[12px] font-semibold text-text-primary">
                      {selectedProvider.providerLabel}
                    </div>
                  </div>
                  {selectorStep === "reasoning" ? null : (
                    <div className="mt-3">
                      {renderSearchField("Search models", close)}
                    </div>
                  )}
                </div>
              ) : null}
            </div>

            <fieldset
              aria-label={
                selectorStep === "provider"
                  ? "Providers"
                  : selectorStep === "model"
                    ? `Models for ${selectedProvider?.providerLabel ?? "the selected provider"}`
                    : `Thinking levels for ${pendingModel?.label ?? activeModel?.label ?? "the selected model"}`
              }
              className={listClassName}
              id={activeListboxId}
            >
              {selectorStep === "provider" ? (
                filteredProviders.length === 0 ? (
                  <div className="px-4 py-4 text-xs text-text-muted">
                    No matching providers.
                  </div>
                ) : (
                  filteredProviders.map((provider) => {
                    const selected =
                      provider.providerId === activeProvider?.providerId;
                    const scopeInfo = codexProviderScopeInfo(
                      provider.providerId,
                    );
                    const providerAvailable =
                      provider.providerAvailable ?? true;
                    const providerDisabledNote =
                      provider.providerAvailabilityNote ?? null;
                    const providerModelCount = provider.modelCount;
                    return (
                      <AppButton
                        key={provider.providerId}
                        aria-disabled={!providerAvailable}
                        aria-selected={selected}
                        buttonStyle="muted"
                        className={`h-auto min-w-0 justify-start gap-3 border-0 px-3 py-1 text-left font-normal ${
                          providerAvailable
                            ? selected
                              ? "bg-surface-3 text-text-primary"
                              : "text-text-secondary hover:bg-surface-2"
                            : selected
                              ? "bg-surface-3 text-text-primary"
                              : "cursor-not-allowed text-text-muted opacity-75"
                        } touch-pan-y`}
                        data-chooser-option="true"
                        fullWidth
                        role="option"
                        onClick={() => {
                          if (!providerAvailable) {
                            return;
                          }
                          handleProviderSelect(provider.providerId);
                        }}
                        onMouseDown={(event) => {
                          event.preventDefault();
                        }}
                        onMouseEnter={(event) => {
                          if (!providerAvailable) {
                            showProviderWarningPopover(
                              event.currentTarget,
                              providerDisabledNote,
                            );
                          }
                        }}
                        onMouseLeave={() => {
                          hideProviderWarningPopover();
                        }}
                        onFocus={(event) => {
                          if (!providerAvailable) {
                            showProviderWarningPopover(
                              event.currentTarget,
                              providerDisabledNote,
                            );
                          }
                        }}
                        onBlur={() => {
                          hideProviderWarningPopover();
                        }}
                        type="button"
                      >
                        <span
                          aria-hidden="true"
                          className={`shrink-0 ${
                            selected ? "text-accent-strong" : "text-text-faint"
                          }`}
                        >
                          {materialSymbol(
                            selected
                              ? "check_circle"
                              : "radio_button_unchecked",
                            "text-[16px]",
                          )}
                        </span>
                        <span className="min-w-0 flex flex-1 items-center gap-3">
                          <span className="min-w-0 flex flex-1 items-center gap-2">
                            <span className="truncate text-[12px] font-semibold text-text-primary">
                              {provider.providerLabel}
                            </span>
                            <span className="shrink-0 text-[11px] text-text-muted">
                              {providerModelCount > 0
                                ? `${providerModelCount} model${providerModelCount === 1 ? "" : "s"}`
                                : "Setup required"}
                            </span>
                          </span>
                          <span className="ml-auto flex shrink-0 items-center gap-2">
                            {variant === "desktop" && scopeInfo ? (
                              <span className="inline-flex shrink-0 border border-border-strong bg-accent-surface px-2 py-1 uppercase-label text-accent-strong">
                                {scopeInfo.badge}
                              </span>
                            ) : null}
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center pl-1 text-text-faint">
                          {materialSymbol("chevron_right", "text-[17px]")}
                        </span>
                      </AppButton>
                    );
                  })
                )
              ) : selectorStep === "model" ? (
                !selectedProviderAvailable ? (
                  <div className="px-4 py-4 text-xs leading-5 text-warning-text">
                    {selectedProviderAvailabilityNote ??
                      "This provider is disabled until it is setup."}
                  </div>
                ) : filteredModels.length === 0 ? (
                  <div className="px-4 py-4 text-xs text-text-muted">
                    No matching models for this provider.
                  </div>
                ) : (
                  filteredModels.map((model) => {
                    const selected = model.id === activeModelId;
                    const reasoningPresentation =
                      reasoningPresentationForModelRow(model);
                    const selectionPath = deriveCodexModelSelectionPath({
                      integratedReasoningEnabled,
                      model,
                      reasoningPresentation,
                      variant,
                    });
                    return (
                      <ModelReasoningSubmenu
                        close={close}
                        key={model.id}
                        model={model}
                        onHoverStateChange={setPendingModelId}
                        onModelSelect={handleModelSelect}
                        onReasoningSelect={(
                          nextReasoningEffort,
                          model,
                          nextClose,
                        ) => {
                          handleReasoningSelect(
                            nextReasoningEffort,
                            nextClose,
                            model,
                          );
                        }}
                        reasoningPresentation={reasoningPresentation}
                        selectionPath={selectionPath}
                        selected={selected}
                      />
                    );
                  })
                )
              ) : pendingModel ? (
                pendingReasoningPresentation.options.map((option) => {
                  const selected =
                    option.id === pendingReasoningPresentation.activeValue;
                  return (
                    <AppButton
                      key={option.id}
                      buttonStyle="muted"
                      className={`h-auto min-w-0 justify-start gap-3 border-0 px-3 py-3 text-left font-normal ${
                        selected
                          ? "bg-surface-3 text-text-primary"
                          : "text-text-secondary hover:bg-surface-2"
                      } touch-pan-y`}
                      data-chooser-option="true"
                      fullWidth
                      role="option"
                      aria-selected={selected}
                      ref={selected ? selectedReasoningOptionRef : undefined}
                      onClick={() => {
                        handleReasoningSelect(option.id, close);
                      }}
                      onMouseDown={(event) => {
                        event.preventDefault();
                      }}
                      type="button"
                    >
                      <span
                        aria-hidden="true"
                        className={`shrink-0 ${
                          selected ? "text-accent-strong" : "text-text-faint"
                        }`}
                      >
                        {materialSymbol(
                          selected ? "check_circle" : "radio_button_unchecked",
                          "text-[16px]",
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block uppercase-label-sm text-inherit">
                          {option.label}
                        </span>
                        <span className="mt-1 block text-[11px] leading-4 text-text-muted">
                          {option.description}
                        </span>
                      </span>
                    </AppButton>
                  );
                })
              ) : (
                <div className="px-4 py-4 text-xs text-text-muted">
                  Choose a model before selecting a thinking level.
                </div>
              )}
            </fieldset>
          </>
        )}
      />
      <PopoverSurface
        className="z-[110] max-w-[20rem] rounded-sm border border-warning-border bg-warning-surface px-3 py-2 text-xs leading-5 text-warning-text shadow-overlay"
        offsetPx={12}
        open={providerWarningPopover !== null}
        placement="right"
        reference={providerWarningPopover?.reference ?? null}
        role="tooltip"
      >
        <div className="flex items-start gap-2">
          <span className="shrink-0 text-warning-text">
            {materialSymbol("warning", "text-[15px]")}
          </span>
          <span className="break-words">{providerWarningPopover?.note}</span>
        </div>
      </PopoverSurface>
    </>
  );
}
