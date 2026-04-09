/**
 * @file src/mainview/controls/thread-access-control.tsx
 * @description Module for thread access control.
 */

import type { JSX } from "react";

import { DropdownControl } from "./dropdown";
import { materialSymbol } from "./icons";

export type ThreadAccessValue = {
  agentsAccess: boolean;
  githubAccess: boolean;
  joltAccess: boolean;
  unsafeMode: boolean;
};

type ThreadAccessControlProps = {
  disabled: boolean;
  onChange: (value: ThreadAccessValue) => void;
  title?: string;
  value: ThreadAccessValue;
  variant: "desktop" | "mobile";
};

function AccessRow({
  accentClassName,
  checked,
  description,
  disabled,
  label,
  onChange,
  toneClassName,
}: {
  accentClassName: string;
  checked: boolean;
  description: string;
  disabled: boolean;
  label: string;
  onChange: (checked: boolean) => void;
  toneClassName: string;
}): JSX.Element {
  return (
    <label
      className={[
        "flex items-start gap-2 border px-1 py-1 transition-colors",
        checked
          ? "border-[#4c6070] bg-[#171d21]"
          : "border-[#303840] bg-[#11161a]",
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
        toneClassName,
      ].join(" ")}
    >
      <input
        checked={checked}
        className={`mt-0.5 h-4 w-4 shrink-0 ${accentClassName}`}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.currentTarget.checked);
        }}
        type="checkbox"
      />
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-[#f0f6fb]">
          {label}
        </span>
        <span className="mt-1 block text-xs leading-5 text-[#9eb1be]">
          {description}
        </span>
      </span>
    </label>
  );
}

/**
 * Thread-level access selector used for thread creation, thread updates, and cron jobs.
 */
export function ThreadAccessControl({
  disabled,
  onChange,
  title = "Access controls for the current thread or cron job.",
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
            "absolute bottom-[calc(100%+0.5rem)] right-0 z-50 overflow-hidden border border-[#3a4751] bg-[#12171b] shadow-[0_24px_60px_rgba(0,0,0,0.52)]",
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
              accentClassName="accent-[#7ea6ff]"
              checked={value.githubAccess}
              description="Allow GitHub tools when they become available."
              disabled={disabled}
              label="GitHub"
              onChange={(checked) => {
                onChange({
                  ...value,
                  githubAccess: checked,
                });
              }}
              toneClassName=""
            />
            <AccessRow
              accentClassName="accent-[#7ce38d]"
              checked={value.agentsAccess}
              description="Allow planning and sub-agent tools."
              disabled={disabled}
              label="Agents"
              onChange={(checked) => {
                onChange({
                  ...value,
                  agentsAccess: checked,
                });
              }}
              toneClassName=""
            />
            <AccessRow
              accentClassName="accent-[#8ed0ff]"
              checked={value.joltAccess}
              description="Allow Jolt tools such as thread, cron, workspace, and vm2 helpers."
              disabled={disabled}
              label="Jolt"
              onChange={(checked) => {
                onChange({
                  ...value,
                  joltAccess: checked,
                });
              }}
              toneClassName=""
            />
            <AccessRow
              accentClassName="accent-[#d89256]"
              checked={value.unsafeMode}
              description="Enable shell access and allow Jolt tools to create unsafe child threads or cron jobs."
              disabled={disabled}
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
            />
          </div>
        </div>
      )}
    />
  );
}
