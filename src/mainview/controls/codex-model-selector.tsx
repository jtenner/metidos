import { type JSX, useEffect, useMemo, useRef, useState } from "react";
import type {
  RpcCodexModelOption,
  RpcCodexReasoningEffort,
  RpcCodexReasoningEffortOption,
} from "../../bun/rpc-schema";
import {
  codexModelLabel,
  findCodexModel,
  findReasoningEffortOption,
  groupCodexModels,
} from "./codex-utils";
import { DropdownControl } from "./dropdown";
import { materialSymbol } from "./icons";
import { matchesSearchQuery, normalizeSearchQuery } from "./search-utils";

type CodexModelSelectorProps = {
  appTitle?: string;
  disabled: boolean;
  models: RpcCodexModelOption[];
  onChange: (value: string) => void;
  onChangeReasoningEffort?: (value: RpcCodexReasoningEffort) => void;
  reasoningDisabled?: boolean;
  reasoningOptions?: RpcCodexReasoningEffortOption[];
  reasoningValue?: RpcCodexReasoningEffort;
  value: string;
  variant: "desktop" | "mobile";
};

/**
 * Model picker used by chat controls.
 * Supports separate desktop/mobile layouts and optional inline reasoning-effort selection
 * in mobile mode when both model + reasoning hooks are available.
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
  // Group by provider/category to keep dropdown scannable for larger catalogs.
  const groupedModels = groupCodexModels(models);
  // Keep local title/selection display in sync with a stable model id.
  const activeModel = findCodexModel(models, value);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [expandedModelId, setExpandedModelId] = useState<string | null>(null);
  const [submenuTop, setSubmenuTop] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const mobilePanelRef = useRef<HTMLDivElement | null>(null);
  const mobileSubmenuRef = useRef<HTMLDivElement | null>(null);
  const mobileModelButtonRefs = useRef<
    Record<string, HTMLButtonElement | null>
  >({});
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Primary button should remain deterministic even while async models/metadata loads.
  const buttonLabel = activeModel
    ? codexModelLabel(activeModel)
    : models.length === 0
      ? "Loading models"
      : "Select model";
  const activeReasoningOption =
    reasoningValue == null
      ? null
      : findReasoningEffortOption(reasoningOptions, reasoningValue);

  // Mobile-only combined selector is used when we can set both model + reasoning effort
  // in one control flow and avoid opening a second popover.
  const combinedMobileSelectorEnabled =
    variant === "mobile" &&
    reasoningValue != null &&
    onChangeReasoningEffort != null &&
    reasoningOptions.length > 0;
  const controlDisabled = combinedMobileSelectorEnabled
    ? disabled || reasoningDisabled
    : disabled;
  const normalizedSearchQuery = normalizeSearchQuery(searchQuery);
  const filteredGroups = useMemo(
    () =>
      groupedModels
        .map((group) => ({
          ...group,
          models: group.models.filter((model) =>
            matchesSearchQuery(
              normalizedSearchQuery,
              model.id,
              model.label,
              model.summary,
              model.group,
            ),
          ),
        }))
        .filter((group) => group.models.length > 0),
    [groupedModels, normalizedSearchQuery],
  );

  // Memoized ID set lets us clear expansion state when filtering hides the active item.
  const filteredModelIds = useMemo(
    () =>
      new Set(
        filteredGroups.flatMap((group) =>
          group.models.map((model) => model.id),
        ),
      ),
    [filteredGroups],
  );
  const expandedModel = useMemo(
    () =>
      expandedModelId == null ? null : findCodexModel(models, expandedModelId),
    [expandedModelId, models],
  );

  useEffect(() => {
    // Opening the dropdown resets navigation/search state so each invocation starts clean.
    if (!dropdownOpen) {
      setSearchQuery("");
      setExpandedModelId(null);
      return;
    }
    searchInputRef.current?.focus();
  }, [dropdownOpen]);

  useEffect(() => {
    // If search filtering removes the currently expanded model, collapse it.
    if (!dropdownOpen || expandedModelId == null) {
      return;
    }
    if (!filteredModelIds.has(expandedModelId)) {
      setExpandedModelId(null);
    }
  }, [dropdownOpen, expandedModelId, filteredModelIds]);

  useEffect(() => {
    // Position the mobile submenu next to the currently expanded model button.
    // We clamp to panel bounds so the flyout never overflows vertically.
    if (!dropdownOpen || expandedModelId == null) {
      return;
    }
    void searchQuery;
    const panelElement = mobilePanelRef.current;
    const buttonElement = mobileModelButtonRefs.current[expandedModelId];
    if (!panelElement || !buttonElement) {
      return;
    }
    const panelRect = panelElement.getBoundingClientRect();
    const buttonRect = buttonElement.getBoundingClientRect();
    const submenuHeight = mobileSubmenuRef.current?.offsetHeight ?? 0;
    const maxTop = Math.max(0, panelElement.offsetHeight - submenuHeight);
    const nextTop = Math.min(
      Math.max(0, buttonRect.top - panelRect.top),
      maxTop,
    );
    setSubmenuTop(nextTop);
  }, [dropdownOpen, expandedModelId, searchQuery]);

  if (combinedMobileSelectorEnabled) {
    // Mobile combined mode shows model + reasoning together in one nested flyout.
    const reasoningLabel = activeReasoningOption?.label ?? "Loading";
    const mobileButtonLabel = activeModel
      ? codexModelLabel(activeModel)
      : models.length === 0
        ? "Loading models"
        : "Select model";

    return (
      <DropdownControl
        canOpen={!controlDisabled}
        disabled={controlDisabled}
        onOpenChange={setDropdownOpen}
        title={
          activeModel && activeReasoningOption
            ? `${codexModelLabel(activeModel)} with ${activeReasoningOption.label} reasoning`
            : (activeModel?.summary ?? `${appTitle} model`)
        }
        renderButton={({ open, toggle }) => (
          <button
            type="button"
            className={`flex h-10 w-full items-center gap-2 overflow-hidden border bg-[#1d2022] px-3 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] transition-colors hover:bg-[#262b2f] ${
              controlDisabled ? "cursor-not-allowed opacity-60" : ""
            } ${
              open
                ? "border-[#9fc1da] shadow-[0_0_0_1px_rgba(159,193,218,0.18)]"
                : "border-[#424e57]"
            }`}
            onClick={toggle}
            disabled={controlDisabled}
            aria-expanded={open}
            aria-haspopup="menu"
          >
            <span className="min-w-0 flex-1 overflow-hidden">
              <span className="block truncate text-[11px] leading-none">
                <span className="text-[#f2f0ef]">{mobileButtonLabel}</span>
                <span className="text-[#8ea0ad]">{` - ${reasoningLabel}`}</span>
              </span>
            </span>
            <span className="flex h-4 shrink-0 items-center leading-none text-[#8f8d8b]">
              {materialSymbol(
                open ? "expand_less" : "expand_more",
                "text-[16px]",
              )}
            </span>
          </button>
        )}
        renderPanel={({ close }) => (
          <div
            ref={mobilePanelRef}
            className="absolute bottom-[calc(100%+0.5rem)] left-0 z-50 w-[min(14rem,calc(100vw-10.5rem))] overflow-visible border border-[#445058] bg-[#171b1d] shadow-[0_18px_38px_rgba(0,0,0,0.42)]"
          >
            <div className="border-b border-[#3c4c58] px-2 py-2">
              <div className="flex items-center gap-2.5 border border-[#3c4c58] bg-[#111213] px-3 py-2">
                {materialSymbol("search", "text-[15px] text-[#98b9d0]")}
                <input
                  ref={searchInputRef}
                  className="min-w-0 flex-1 bg-transparent text-[11px] text-[#f2f0ef] outline-none placeholder:text-[#727e86]"
                  placeholder="Search models"
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
                    aria-label="Clear model search"
                  >
                    ×
                  </button>
                ) : null}
              </div>
            </div>
            <div
              className="max-h-80 overflow-y-auto py-2 hide-scrollbar"
              onScroll={() => {
                // Dismiss nested menu when parent list scrolls for stable positioning.
                if (expandedModelId != null) {
                  setExpandedModelId(null);
                }
              }}
            >
              {filteredGroups.length === 0 ? (
                <div className="px-4 py-4 text-xs text-[#8f9aa2]">
                  No matching models.
                </div>
              ) : null}
              {filteredGroups.map((group) => (
                <div key={group.group} className="px-2 pb-2 last:pb-0">
                  <div className="px-2 pb-1 pt-1 font-label text-[9px] uppercase tracking-[0.18em] text-[#92a7b6]">
                    {group.group}
                  </div>
                  <div>
                    {group.models.map((model) => {
                      const selected = model.id === value;
                      const expanded = model.id === expandedModelId;
                      return (
                        <button
                          key={model.id}
                          ref={(node) => {
                            mobileModelButtonRefs.current[model.id] = node;
                          }}
                          type="button"
                          className={`flex w-full items-start gap-3 px-2 py-2 text-left transition-colors ${
                            expanded
                              ? "bg-[#21303a] text-[#f8fafc]"
                              : selected
                                ? "bg-[#28353e] text-[#f8fafc]"
                                : "text-[#ebf3f8] hover:bg-[#1e2428]"
                          }`}
                          onClick={() => {
                            // Keep "expanded" as active hover target only; commit selected
                            // model is done through main actions below.
                            setExpandedModelId(model.id);
                          }}
                          onFocus={() => {
                            setExpandedModelId(model.id);
                          }}
                          onMouseEnter={() => {
                            setExpandedModelId(model.id);
                          }}
                          aria-expanded={expanded}
                          aria-haspopup="menu"
                        >
                          <span
                            className={`mt-0.5 shrink-0 ${
                              selected || expanded
                                ? "text-[#bdd5e6]"
                                : "text-[#5e676e]"
                            }`}
                          >
                            {materialSymbol(
                              selected
                                ? "check_circle"
                                : "radio_button_unchecked",
                              "text-[16px]",
                            )}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block font-label text-[10px] font-bold uppercase tracking-wider text-inherit">
                              {codexModelLabel(model)}
                            </span>
                            <span
                              className={`mt-1 block text-[11px] leading-4 ${
                                selected || expanded
                                  ? "text-[#d5e4ef]"
                                  : "text-[#a7b7c2]"
                              }`}
                            >
                              {model.summary}
                            </span>
                          </span>
                          <span className="mt-0.5 flex shrink-0 items-center pl-1">
                            <span
                              className={`${
                                expanded ? "text-[#bdd5e6]" : "text-[#5e676e]"
                              }`}
                            >
                              {materialSymbol("chevron_right", "text-[16px]")}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            {expandedModel ? (
              <div
                ref={mobileSubmenuRef}
                className="absolute left-[calc(100%+0.5rem)] z-10 w-[9.75rem] overflow-hidden border border-[#445058] bg-[#14181a] shadow-[0_18px_38px_rgba(0,0,0,0.42)]"
                style={{ top: submenuTop }}
              >
                <div className="border-b border-[#3c4c58] px-3 py-2">
                  <div className="font-label text-[9px] uppercase tracking-[0.18em] text-[#92a7b6]">
                    Reasoning Effort
                  </div>
                  <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#e3edf4]">
                    {codexModelLabel(expandedModel)}
                  </div>
                </div>
                <div className="py-2">
                  {reasoningOptions.map((option) => {
                    const selected = option.id === reasoningValue;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        className={`flex w-full items-center gap-3 px-3 py-2 text-left transition-colors ${
                          selected
                            ? "bg-[#28353e] text-[#f8fafc]"
                            : "text-[#ebf3f8] hover:bg-[#1e2428]"
                        }`}
                        onClick={() => {
                          // Close first so any parent overlays collapse before the
                          // app-level state updates run.
                          close();
                          if (expandedModel.id !== value) {
                            onChange(expandedModel.id);
                          }
                          if (option.id !== reasoningValue) {
                            onChangeReasoningEffort(option.id);
                          }
                        }}
                      >
                        <span
                          className={`shrink-0 ${
                            selected ? "text-[#bdd5e6]" : "text-[#5e676e]"
                          }`}
                        >
                          {materialSymbol(
                            selected
                              ? "check_circle"
                              : "radio_button_unchecked",
                            "text-[16px]",
                          )}
                        </span>
                        <span className="min-w-0 flex-1 font-label text-[10px] font-bold uppercase tracking-wider text-inherit">
                          {option.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        )}
      />
    );
  }

  return (
    <DropdownControl
      canOpen={!controlDisabled}
      disabled={controlDisabled}
      onOpenChange={setDropdownOpen}
      title={activeModel?.summary ?? `${appTitle} model`}
      renderButton={({ open, toggle }) => (
        <button
          type="button"
          className={`flex w-full items-center overflow-hidden border text-left transition-colors ${
            variant === "desktop"
              ? "h-7 gap-1 border-[#3a3a44] bg-[#131313] px-2.5 hover:bg-[#191c1f]"
              : "h-10 gap-2 border-[#424e57] bg-[#1d2022] px-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] hover:bg-[#262b2f]"
          } ${disabled ? "cursor-not-allowed opacity-60" : ""} ${
            open
              ? "border-[#9fc1da] shadow-[0_0_0_1px_rgba(159,193,218,0.18)]"
              : ""
          }`}
          onClick={toggle}
          disabled={controlDisabled}
          aria-expanded={open}
          aria-haspopup="menu"
        >
          <span className="min-w-0 flex-1">
            <span
              className={`block truncate font-label font-bold uppercase text-[#f2f0ef] ${
                variant === "desktop"
                  ? "text-[10px] leading-none tracking-wider"
                  : "text-[10px] leading-none tracking-widest"
              }`}
            >
              {buttonLabel}
            </span>
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
        <div
          className={`absolute left-0 right-0 bottom-[calc(100%+0.5rem)] overflow-hidden border shadow-[0_18px_38px_rgba(0,0,0,0.42)] ${
            variant === "desktop"
              ? "z-40 border-[#3c4c58] bg-[#15191b]"
              : "z-50 border-[#445058] bg-[#171b1d]"
          }`}
        >
          <div className="border-b border-[#3c4c58] px-2 py-2">
            <div className="flex items-center gap-2.5 border border-[#3c4c58] bg-[#111213] px-3 py-2">
              {materialSymbol("search", "text-[15px] text-[#98b9d0]")}
              <input
                ref={searchInputRef}
                className="min-w-0 flex-1 bg-transparent text-[11px] text-[#f2f0ef] outline-none placeholder:text-[#727e86]"
                placeholder="Search models"
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
                  aria-label="Clear model search"
                >
                  ×
                </button>
              ) : null}
            </div>
          </div>
          <div className="max-h-80 overflow-y-auto py-2 hide-scrollbar">
            {filteredGroups.length === 0 ? (
              <div className="px-4 py-4 text-xs text-[#8f9aa2]">
                No matching models.
              </div>
            ) : null}
            {filteredGroups.map((group) => (
              <div key={group.group} className="px-2 pb-2 last:pb-0">
                <div className="px-2 pb-1 pt-1 font-label text-[9px] uppercase tracking-[0.18em] text-[#92a7b6]">
                  {group.group}
                </div>
                <div>
                  {group.models.map((model) => {
                    const selected = model.id === value;
                    return (
                      <button
                        key={model.id}
                        type="button"
                        className={`flex w-full items-start gap-3 px-2 py-2 text-left transition-colors ${
                          selected
                            ? "bg-[#28353e] text-[#f8fafc]"
                            : "text-[#ebf3f8] hover:bg-[#1e2428]"
                        }`}
                        onClick={() => {
                          // Desktop path changes only the model and closes immediately.
                          close();
                          if (model.id !== value) {
                            onChange(model.id);
                          }
                        }}
                      >
                        <span
                          className={`mt-0.5 shrink-0 ${
                            selected ? "text-[#bdd5e6]" : "text-[#5e676e]"
                          }`}
                        >
                          {materialSymbol(
                            selected
                              ? "check_circle"
                              : "radio_button_unchecked",
                            "text-[16px]",
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block font-label text-[10px] font-bold uppercase tracking-wider text-inherit">
                            {codexModelLabel(model)}
                          </span>
                          <span
                            className={`mt-1 block text-[11px] leading-4 ${
                              selected ? "text-[#d5e4ef]" : "text-[#a7b7c2]"
                            }`}
                          >
                            {model.summary}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    />
  );
}
