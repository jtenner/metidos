import { type JSX, useEffect, useMemo, useRef, useState } from "react";
import type { RpcCodexModelOption } from "../../bun/rpc-schema";
import {
  codexModelLabel,
  findCodexModel,
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
  value: string;
  variant: "desktop" | "mobile";
};

export function CodexModelSelector({
  appTitle = "Jolt",
  disabled,
  models,
  onChange,
  value,
  variant,
}: CodexModelSelectorProps): JSX.Element {
  const groupedModels = groupCodexModels(models);
  const activeModel = findCodexModel(models, value);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const buttonLabel = activeModel
    ? codexModelLabel(activeModel)
    : models.length === 0
      ? "Loading models"
      : "Select model";
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

  useEffect(() => {
    if (!dropdownOpen) {
      setSearchQuery("");
      return;
    }
    searchInputRef.current?.focus();
  }, [dropdownOpen]);

  return (
    <DropdownControl
      canOpen={!disabled}
      disabled={disabled}
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
          disabled={disabled}
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
