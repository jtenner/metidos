/**
 * @file src/mainview/app/auth-step-up-dialog.tsx
 * @description Modal prompt for recent step-up authentication before sensitive actions.
 */

import { type FormEvent, type JSX, useId } from "react";

import { AppButton } from "../controls/button";
import { ModalDialogSurface } from "../controls/popover";

export type AuthStepUpDialogContentProps = {
  actionLabel?: string;
  error: string;
  loading: boolean;
  onCancel: () => void;
  onPrimaryFactorChange: (value: string) => void;
  onSubmit: () => void;
  onTotpCodeChange: (value: string) => void;
  primaryFactor: string;
  primaryFactorInputId?: string;
  totpCode: string;
  totpCodeInputId?: string;
};

export function AuthStepUpDialogContent({
  actionLabel = "Continue",
  error,
  loading,
  onCancel,
  onPrimaryFactorChange,
  onSubmit,
  onTotpCodeChange,
  primaryFactor,
  primaryFactorInputId,
  totpCode,
  totpCodeInputId,
}: AuthStepUpDialogContentProps): JSX.Element {
  const generatedPrimaryFactorInputId = useId();
  const generatedTotpCodeInputId = useId();
  const primaryInputId = primaryFactorInputId ?? generatedPrimaryFactorInputId;
  const totpInputId = totpCodeInputId ?? generatedTotpCodeInputId;

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    onSubmit();
  };

  return (
    <form className="space-y-3" onSubmit={submit}>
      <div className="space-y-1">
        <label
          className="block text-[10px] font-semibold uppercase tracking-[0.1em] text-text-faint"
          htmlFor={primaryInputId}
        >
          PIN or password
        </label>
        <input
          autoComplete="current-password"
          className="h-8 w-full border border-border-default bg-surface-1 px-2 text-sm text-text-primary outline-none focus:border-accent focus:ring-2 focus:ring-accent/25"
          disabled={loading}
          id={primaryInputId}
          onChange={(event) => {
            onPrimaryFactorChange(event.currentTarget.value);
          }}
          type="password"
          value={primaryFactor}
        />
      </div>
      <div className="space-y-1">
        <label
          className="block text-[10px] font-semibold uppercase tracking-[0.1em] text-text-faint"
          htmlFor={totpInputId}
        >
          TOTP code
        </label>
        <input
          autoComplete="one-time-code"
          className="h-8 w-full border border-border-default bg-surface-1 px-2 font-mono text-sm text-text-primary outline-none focus:border-accent focus:ring-2 focus:ring-accent/25"
          disabled={loading}
          id={totpInputId}
          inputMode="numeric"
          onChange={(event) => {
            onTotpCodeChange(event.currentTarget.value.replace(/\D+/g, ""));
          }}
          pattern="[0-9]*"
          value={totpCode}
        />
      </div>
      {error ? (
        <div className="border border-danger-border bg-danger-surface px-3 py-2 text-xs leading-5 text-danger-text">
          {error}
        </div>
      ) : null}
      <div className="flex justify-end gap-2 border-t border-border-subtle pt-3">
        <AppButton buttonStyle="muted" disabled={loading} onClick={onCancel}>
          Cancel
        </AppButton>
        <AppButton buttonStyle="primary" disabled={loading} type="submit">
          {loading ? "Verifying…" : actionLabel}
        </AppButton>
      </div>
    </form>
  );
}

export type AuthStepUpDialogProps = AuthStepUpDialogContentProps & {
  description?: string;
  open: boolean;
  title?: string;
};

export function AuthStepUpDialog({
  description = "Confirm your primary factor and TOTP code to continue with this sensitive action.",
  open,
  title = "Authentication required",
  ...contentProps
}: AuthStepUpDialogProps): JSX.Element {
  const titleId = useId();
  const descriptionId = useId();

  return (
    <ModalDialogSurface
      aria-describedby={descriptionId}
      aria-labelledby={titleId}
      backdropClassName="absolute inset-0 bg-bg-app/70"
      backdropLabel="Cancel authentication"
      className="w-full max-w-sm border border-border-default bg-surface-overlay text-text-primary shadow-overlay"
      onRequestClose={() => {
        if (!contentProps.loading) {
          contentProps.onCancel();
        }
      }}
      open={open}
      overlayClassName="fixed inset-0 z-[140] flex items-center justify-center px-4 py-6"
      restoreFocus={true}
    >
      <div className="border-b border-border-subtle bg-surface-2 px-4 py-3">
        <div
          className="text-base font-semibold leading-5 text-text-primary"
          id={titleId}
        >
          {title}
        </div>
        <div
          className="mt-1 text-xs leading-5 text-text-muted"
          id={descriptionId}
        >
          {description}
        </div>
      </div>
      <div className="px-4 py-4">
        <AuthStepUpDialogContent {...contentProps} />
      </div>
    </ModalDialogSurface>
  );
}
