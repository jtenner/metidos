/**
 * @file src/mainview/app/settings-panel.tsx
 * @description Module for settings panel.
 */

import { type JSX, useId } from "react";

import { DropdownControl } from "../controls/dropdown";
import { materialSymbol } from "../controls/icons";

type SettingsPanelProps = {
  variant: "desktop" | "mobile";
};

/**
 * Top-right settings trigger and placeholder panel for future app preferences.
 */
export function SettingsPanel({ variant }: SettingsPanelProps): JSX.Element {
  const panelId = useId();
  const buttonClassName =
    variant === "desktop"
      ? "rounded-full p-2 text-[#9da8b1] transition hover:bg-[#262626] hover:text-[#f2f0ef] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7aa5c4]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#131313]"
      : "rounded-full p-2 text-[#bdd5e6] transition hover:bg-[#161d21] hover:text-[#f2f0ef] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7aa5c4]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0e0e0e]";

  return (
    <DropdownControl
      rootClassName="relative"
      renderButton={({ open, toggle }) => (
        <button
          aria-controls={panelId}
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-label={open ? "Close settings" : "Open settings"}
          className={`${buttonClassName} ${open ? "bg-[#1b2328] text-[#f2f0ef]" : ""}`}
          onClick={toggle}
          type="button"
        >
          {materialSymbol("settings", "text-[18px]")}
        </button>
      )}
      renderPanel={({ close }) => (
        <div
          aria-label="Settings"
          className="absolute right-0 top-full z-[95] mt-3 w-[20rem] max-w-[calc(100vw-1rem)] overflow-hidden rounded-2xl border border-[#31414d] bg-[#141b20]/95 text-[#f2f0ef] shadow-[0_24px_70px_rgba(0,0,0,0.52)] backdrop-blur-xl"
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
              No preferences are wired up yet, but this panel is now part of the
              app shell so future settings have a stable home.
            </p>
          </div>

          <div className="space-y-3 px-4 py-4">
            <div className="font-label text-[10px] uppercase tracking-[0.16em] text-[#7ea2b8]">
              Future categories
            </div>

            <div className="flex items-center justify-between rounded-xl border border-[#2b3943] bg-[#11171b]/80 px-3 py-3">
              <div className="flex items-center gap-2 text-sm text-[#d7e1e8]">
                {materialSymbol("checklist", "text-[15px] text-[#8fb5cd]")}
                <span>Application preferences</span>
              </div>
              <span className="rounded-full border border-[#365264] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#8fb5cd]">
                Soon
              </span>
            </div>

            <div className="flex items-center justify-between rounded-xl border border-[#2b3943] bg-[#11171b]/80 px-3 py-3">
              <div className="flex items-center gap-2 text-sm text-[#d7e1e8]">
                {materialSymbol("chat_bubble", "text-[15px] text-[#8fb5cd]")}
                <span>Thread defaults</span>
              </div>
              <span className="rounded-full border border-[#365264] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#8fb5cd]">
                Soon
              </span>
            </div>

            <div className="flex items-center justify-between rounded-xl border border-[#2b3943] bg-[#11171b]/80 px-3 py-3">
              <div className="flex items-center gap-2 text-sm text-[#d7e1e8]">
                {materialSymbol("account_circle", "text-[15px] text-[#8fb5cd]")}
                <span>Profile and workspace options</span>
              </div>
              <span className="rounded-full border border-[#365264] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#8fb5cd]">
                Soon
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-[#27333c] bg-[#11171b]/70 px-4 py-3">
            <div className="text-xs text-[#859aa8]">
              Settings will live here as the app grows.
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
