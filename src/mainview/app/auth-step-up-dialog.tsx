/**
 * @file src/mainview/app/auth-step-up-dialog.tsx
 * @description Module for auth step up dialog.
 */

import type { FormEvent, JSX } from "react";
import type { AuthPrimaryFactorType } from "../../bun/db";

type AuthStepUpDialogProps = {
  actionLabel: string;
  busy: boolean;
  error: string;
  onCancel: () => void;
  onPrimaryFactorChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onTotpCodeChange: (value: string) => void;
  open: boolean;
  primaryFactorType: AuthPrimaryFactorType | null;
  primaryFactorValue: string;
  totpCodeValue: string;
};

/**
 * Function of AuthStepUpDialog.
 * @param actionLabel - The value of `actionLabel`.
 * @param busy - The value of `busy`.
 * @param error - The value of `error`.
 * @param onCancel - The value of `onCancel`.
 * @param onPrimaryFactorChange - The value of `onPrimaryFactorChange`.
 * @param onSubmit - The value of `onSubmit`.
 * @param onTotpCodeChange - The value of `onTotpCodeChange`.
 * @param open - The value of `open`.
 * @param primaryFactorType - The value of `primaryFactorType`.
 * @param primaryFactorValue - The value of `primaryFactorValue`.
 * @param totpCodeValue - The value of `totpCodeValue`.
 */
export function AuthStepUpDialog({
  actionLabel,
  busy,
  error,
  onCancel,
  onPrimaryFactorChange,
  onSubmit,
  onTotpCodeChange,
  open,
  primaryFactorType,
  primaryFactorValue,
  totpCodeValue,
}: AuthStepUpDialogProps): JSX.Element | null {
  if (!open) {
    return null;
  }

  const primaryFactorLabel =
    primaryFactorType === "pin" ? "PIN" : "Password / passphrase";

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 px-4 py-6">
      <dialog
        aria-modal="true"
        className="w-full max-w-lg rounded-2xl border border-[#36424b] bg-[#14181b] p-0 text-[#f2f0ef] shadow-2xl shadow-black/50"
        open
      >
        <form className="p-5" onSubmit={onSubmit}>
          <div className="mb-2 font-label text-[11px] uppercase tracking-[0.18em] text-[#8fb5cd]">
            Step-Up Required
          </div>
          <div className="mb-2 text-lg font-semibold text-[#f2f0ef]">
            Re-authenticate before continuing
          </div>
          <div className="mb-5 text-sm leading-6 text-[#b7c8d4]">
            Enter your configured{" "}
            {primaryFactorType === "pin" ? "PIN" : "password"} and the current
            authenticator code to {actionLabel}.
          </div>

          <div className="space-y-4">
            <label className="block space-y-2">
              <span className="font-label text-[10px] font-semibold tracking-[0.18em] text-[#89a6ba] uppercase">
                {primaryFactorLabel}
              </span>
              <input
                autoComplete="current-password"
                autoFocus
                className="w-full rounded-xl border border-[#33404a] bg-[#0f1418] px-3 py-3 text-sm text-[#f2f0ef] outline-none transition focus:border-[#6aa6cc]"
                inputMode={primaryFactorType === "pin" ? "numeric" : "text"}
                onChange={(event) => {
                  onPrimaryFactorChange(event.currentTarget.value);
                }}
                placeholder={
                  primaryFactorType === "pin"
                    ? "Enter your PIN"
                    : "Enter your password or passphrase"
                }
                type="password"
                value={primaryFactorValue}
              />
            </label>

            <label className="block space-y-2">
              <span className="font-label text-[10px] font-semibold tracking-[0.18em] text-[#89a6ba] uppercase">
                TOTP code
              </span>
              <input
                autoComplete="one-time-code"
                className="w-full rounded-xl border border-[#33404a] bg-[#0f1418] px-3 py-3 text-sm text-[#f2f0ef] outline-none transition focus:border-[#6aa6cc]"
                inputMode="numeric"
                maxLength={6}
                onChange={(event) => {
                  onTotpCodeChange(event.currentTarget.value);
                }}
                placeholder="Enter the current 6-digit authenticator code"
                type="text"
                value={totpCodeValue}
              />
            </label>
          </div>

          {error ? (
            <div className="mt-4 rounded-xl border border-[#6b3a3a] bg-[#2a1717] px-4 py-3 text-sm text-[#ffb9b9]">
              {error}
            </div>
          ) : null}

          <div className="mt-5 flex items-center justify-between gap-3">
            <div className="text-xs text-[#8094a1]">
              Protected actions require a recent primary-factor plus TOTP
              confirmation.
            </div>
            <div className="flex items-center gap-3">
              <button
                className="rounded-full border border-[#46535c] px-4 py-2 text-sm text-[#d4dee5] transition hover:border-[#6d7b85] hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                disabled={busy}
                onClick={onCancel}
                type="button"
              >
                Cancel
              </button>
              <button
                className="rounded-full bg-[#bdd5e6] px-4 py-2 text-sm font-semibold text-[#0f1418] transition hover:bg-[#d8e6f0] disabled:cursor-not-allowed disabled:opacity-60"
                disabled={busy}
                type="submit"
              >
                {busy ? "Verifying..." : "Verify and continue"}
              </button>
            </div>
          </div>
        </form>
      </dialog>
    </div>
  );
}
