/**
 * @file src/mainview/controls/thread-access-control.tsx
 * @description Module for thread access control.
 */

import { type JSX, useId } from "react";

import { DropdownControl } from "./dropdown";
import { type AppIconName, materialSymbol } from "./icons";

export type ThreadAccessValue = {
  agentsAccess: boolean;
  githubAccess: boolean;
  metidosAccess: boolean;
  unsafeMode: boolean;
  webSearchAccess: boolean;
};

type ThreadAccessControlProps = {
  disabled: boolean;
  onChange: (value: ThreadAccessValue) => void;
  title?: string;
  unsafeModeDisabled?: boolean;
  value: ThreadAccessValue;
  variant: "desktop" | "mobile";
};

export function accessDescriptionPopoverPositionClassName(
  variant: ThreadAccessControlProps["variant"],
): string {
  return variant === "desktop"
    ? "left-full top-1/2 ml-2 -translate-y-1/2"
    : "right-full top-1/2 mr-2 -translate-y-1/2";
}

function AccessDescriptionPopover({
  description,
  label,
  variant,
}: {
  description: string;
  label: string;
  variant: ThreadAccessControlProps["variant"];
}): JSX.Element {
  const tooltipId = useId();

  return (
    <span className="group/access-tooltip relative shrink-0 self-center">
      <button
        aria-describedby={tooltipId}
        aria-label={`About ${label} access`}
        className="inline-flex h-5 w-5 items-center justify-center text-[11px] font-semibold leading-none text-[#9eb1be] transition-colors hover:text-[#f4f8fb] focus-visible:text-[#f4f8fb] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#5d7e93] focus-visible:outline-offset-1"
        type="button"
      >
        ?
      </button>
      <span
        aria-hidden="true"
        className={[
          "pointer-events-none invisible absolute z-50 w-[15rem] max-w-[min(72vw,15rem)] border border-[#3c5462] bg-[#141b20] px-2.5 py-2 text-left text-[11px] leading-5 text-[#e2eef7] opacity-0 shadow-[0_18px_38px_rgba(0,0,0,0.42)] transition-opacity duration-150 group-hover/access-tooltip:visible group-hover/access-tooltip:opacity-100 group-focus-within/access-tooltip:visible group-focus-within/access-tooltip:opacity-100",
          accessDescriptionPopoverPositionClassName(variant),
        ].join(" ")}
        id={tooltipId}
        role="tooltip"
      >
        {description}
      </span>
    </span>
  );
}

function AccessRow({
  accentClassName,
  checked,
  description,
  disabled,
  iconClassName,
  iconName,
  label,
  onChange,
  toneClassName,
  variant,
}: {
  accentClassName: string;
  checked: boolean;
  description: string;
  disabled: boolean;
  iconClassName?: string;
  iconName?: AppIconName;
  label: string;
  onChange: (checked: boolean) => void;
  toneClassName: string;
  variant: ThreadAccessControlProps["variant"];
}): JSX.Element {
  return (
    <div
      className={[
        "flex items-center gap-2 border px-1 py-1 transition-colors",
        checked
          ? "border-[#4c6070] bg-[#171d21]"
          : "border-[#303840] bg-[#11161a]",
        disabled ? "opacity-60" : "",
        toneClassName,
      ].join(" ")}
    >
      <label
        className={[
          "flex min-w-0 flex-1 items-center gap-2",
          disabled ? "cursor-not-allowed" : "cursor-pointer",
        ].join(" ")}
      >
        <input
          checked={checked}
          className={`h-4 w-4 shrink-0 ${accentClassName}`}
          disabled={disabled}
          onChange={(event) => {
            onChange(event.currentTarget.checked);
          }}
          type="checkbox"
        />
        {iconName ? (
          <span
            aria-hidden="true"
            className={[
              "flex h-4 w-4 shrink-0 items-center justify-center",
              iconClassName ?? "text-[#9eb1be]",
            ].join(" ")}
          >
            {materialSymbol(iconName, "text-[13px]")}
          </span>
        ) : null}
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-semibold leading-4 uppercase tracking-[0.14em] text-[#f0f6fb]">
            {label}
          </span>
        </span>
      </label>
      <AccessDescriptionPopover
        description={description}
        label={label}
        variant={variant}
      />
    </div>
  );
}

/**
 * Thread-level access selector used for thread creation, thread updates, and cron jobs.
 */
export function ThreadAccessControl({
  disabled,
  onChange,
  title = "Access controls for the current thread or cron job.",
  unsafeModeDisabled = false,
  value,
  variant,
}: ThreadAccessControlProps): JSX.Element {
  const compact = variant === "mobile";

  return (
    <DropdownControl
      canOpen={!disabled}
      closeOnDisable={false}
      disabled={disabled}
      rootClassName="relative inline-flex overflow-visible"
      title={`${title}`}
      renderButton={({ open, toggle }) => (
        <button
          aria-expanded={open}
          aria-haspopup="dialog"
          className={[
            "inline-flex h-7 items-center gap-2 border px-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.16em] transition-colors",
            disabled
              ? "cursor-not-allowed border-[#39444b] bg-[#15191c] text-[#8797a2] opacity-70"
              : open
                ? "border-[#5a7384] bg-[#1c2429] text-[#f2f0ef]"
                : "border-[#36424a] bg-[#14191c] text-[#d3dde5] hover:border-[#506271] hover:bg-[#1b2328]",
          ].join(" ")}
          disabled={disabled}
          onClick={toggle}
          type="button"
        >
          <span className="flex items-center gap-2">
            {materialSymbol("shield", "text-[15px] leading-none")}
            <span>Access</span>
          </span>
          <span className="ml-1 flex min-w-0 items-center gap-1 text-[10px] font-medium tracking-[0.12em] text-[#8ea0ad]">
            <span aria-hidden="true" className="text-[#6f818d]">
              {materialSymbol(
                open ? "expand_less" : "expand_more",
                "text-[16px]",
              )}
            </span>
          </span>
        </button>
      )}
      renderPanel={() => (
        <div
          className={[
            "absolute bottom-[calc(100%+0.5rem)] right-0 z-50 overflow-visible border border-[#3a4751] bg-[#12171b] shadow-[0_24px_60px_rgba(0,0,0,0.52)]",
            compact
              ? "w-[18rem] max-w-[calc(100vw-1rem)]"
              : "w-[20rem] max-w-[calc(100vw-2rem)]",
          ].join(" ")}
        >
          <div className="border-b border-[#27323a] px-4 py-3">
            <div className="font-label text-[10px] uppercase tracking-[0.18em] text-[#8fb5cd]">
              Access controls
            </div>
          </div>
          <div className="space-y-2 p-3">
            <AccessRow
              accentClassName="accent-[#69c6ff]"
              checked={value.webSearchAccess}
              description="Allow web search for current information. Metidos uses provider-native search when available and falls back to local Ollama web tools otherwise."
              disabled={disabled}
              iconClassName="text-[#7fd6ff]"
              iconName="public"
              label="Web Search"
              onChange={(checked) => {
                onChange({
                  ...value,
                  webSearchAccess: checked,
                });
              }}
              toneClassName=""
              variant={variant}
            />
            <AccessRow
              accentClassName="accent-[#7ea6ff]"
              checked={value.githubAccess}
              description="Allow GitHub repo, issue, pull-request, checks, and diff tools scoped to the current repository."
              disabled={disabled}
              iconClassName="text-[#8fb6ff]"
              iconName="code"
              label="GitHub"
              onChange={(checked) => {
                onChange({
                  ...value,
                  githubAccess: checked,
                });
              }}
              toneClassName=""
              variant={variant}
            />
            <AccessRow
              accentClassName="accent-[#7ce38d]"
              checked={value.agentsAccess}
              description="Allow plan updates and one-shot delegated helper tasks."
              disabled={disabled}
              iconClassName="text-[#8ff1a2]"
              iconName="checklist"
              label="Agents"
              onChange={(checked) => {
                onChange({
                  ...value,
                  agentsAccess: checked,
                });
              }}
              toneClassName=""
              variant={variant}
            />
            <AccessRow
              accentClassName="accent-[#8ed0ff]"
              checked={value.metidosAccess}
              description="Allow Metidos tools such as thread, cron, workspace, and vm2 helpers."
              disabled={disabled}
              iconClassName="text-[#9dd8ff]"
              iconName="folder_open"
              label="Metidos"
              onChange={(checked) => {
                onChange({
                  ...value,
                  metidosAccess: checked,
                });
              }}
              toneClassName=""
              variant={variant}
            />
            <AccessRow
              accentClassName="accent-[#d89256]"
              checked={value.unsafeMode}
              description="Opt in to shell access and allow Metidos tools to create unsafe child threads or cron jobs. Leave this off unless you intentionally need broader execution."
              disabled={disabled || unsafeModeDisabled}
              iconClassName="text-[#f2d79b]"
              iconName="terminal"
              label="Unsafe"
              onChange={(checked) => {
                onChange({
                  ...value,
                  unsafeMode: checked,
                });
              }}
              toneClassName={[
                "border-[#6d5930]",
                value.unsafeMode ? "bg-[#2a1d10]" : "bg-[#1e1710]",
                "text-[#f2d79b]",
              ].join(" ")}
              variant={variant}
            />
          </div>
        </div>
      )}
    />
  );
}
