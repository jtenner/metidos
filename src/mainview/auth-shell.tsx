/**
 * @file src/mainview/auth-shell.tsx
 * @description Module for auth shell.
 */

import {
  type FormEvent,
  type JSX,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ProjectProcedures } from "../bun/rpc-schema";
import App from "./App";
import {
  AUTH_REQUIRED_EVENT_NAME,
  AuthApiError,
  type AuthStatus,
  completeAuthSetup,
  getAuthStatus,
  loginAuth,
  loginWithRecoveryCodeAuth,
  prepareSetupEnrollment,
  type TotpEnrollment,
} from "./auth-client";
import { resolveAuthShellGate } from "./auth-shell-connect";
import { AppButton } from "./controls/button";

type AuthShellProps = {
  connectRpcTransport: () => Promise<void>;
  disconnectRpcTransport: () => void;
  procedures: ProjectProcedures;
};

type AuthView =
  | "app"
  | "loading"
  | "login"
  | "recovery"
  | "recovery-login"
  | "setup";

const SESSION_LIFETIME_DAYS = 7;
const AUTH_DATE_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function readThemeColor(name: string, fallback: string): string {
  if (typeof document === "undefined") {
    return fallback;
  }
  return (
    getComputedStyle(document.documentElement).getPropertyValue(name).trim() ||
    fallback
  );
}

/**
 * Formats date time.
 * @param value - Input value.
 */
function formatDateTime(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return null;
  }

  return AUTH_DATE_TIME_FORMATTER.format(timestamp);
}

/**
 * Convert common auth errors to user-facing messages.
 * @param error - Unknown error payload from API or UI.
 */
function errorMessage(error: unknown): string {
  if (error instanceof AuthApiError) {
    return error.message;
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  return "An unexpected authentication error occurred.";
}

/**
 * Resolve the lockout expiry timestamp from auth state or error details.
 * @param status - Latest auth status state.
 * @param error - Error that triggered status refresh.
 */
function readLockedUntil(
  status: AuthStatus | null,
  error: unknown,
): string | null {
  if (error instanceof AuthApiError) {
    const lockedUntil = error.details?.lockedUntil;
    if (typeof lockedUntil === "string") {
      return lockedUntil;
    }
  }
  return status?.lockedUntil ?? null;
}

/**
 * Render a consistent action button with shared style variants.
 * @param props - Button configuration for auth UI actions.
 */
function AuthActionButton(props: {
  children: JSX.Element | string;
  disabled?: boolean;
  onClick?: () => void;
  type?: "button" | "submit";
  variant: "primary" | "secondary";
  wide?: boolean;
}): JSX.Element {
  return (
    <AppButton
      buttonStyle={props.variant}
      className={props.wide ? "w-full" : ""}
      disabled={props.disabled}
      fullWidth={props.wide === true}
      onClick={props.onClick}
      type={props.type ?? "button"}
    >
      {props.children}
    </AppButton>
  );
}

/**
 * Render a selectable auth-flow choice control.
 * @param props - Choice button content and click handler.
 */
function AuthChoiceButton(props: {
  active: boolean;
  body: string;
  onClick: () => void;
  title: string;
}): JSX.Element {
  return (
    <AppButton
      buttonStyle={props.active ? "secondary" : "muted"}
      className={[
        "h-auto flex-col items-start justify-start px-5 py-5 text-left leading-normal",
        props.active ? "border-accent bg-surface-3" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      fullWidth
      onClick={props.onClick}
      type="button"
    >
      <div className="font-label text-[11px] font-semibold tracking-[0.2em] text-inherit uppercase">
        {props.title}
      </div>
      <div
        className={`mt-2 text-sm leading-6 ${
          props.active ? "text-text-primary" : "text-text-muted"
        }`}
      >
        {props.body}
      </div>
    </AppButton>
  );
}

/**
 * Render a styled labeled text/password input field.
 * @param props - Input field properties.
 */
function AuthInput(props: {
  autoComplete?: string;
  inputMode?: "numeric" | "text";
  label: string;
  maxLength?: number;
  monospace?: boolean;
  onChange: (value: string) => void;
  placeholder: string;
  type?: "password" | "text";
  value: string;
}): JSX.Element {
  return (
    <label className="block">
      <span className="font-mono text-[11px] tracking-[0.22em] text-accent uppercase">
        {props.label}
      </span>
      <div className="mt-4 border border-border-default bg-surface-1 px-4 py-3 transition focus-within:border-focus-ring focus-within:bg-surface-2">
        <input
          autoComplete={props.autoComplete}
          className={`w-full bg-transparent text-base text-text-primary outline-none placeholder:text-text-faint ${
            props.monospace ? "font-mono tracking-[0.16em]" : ""
          }`}
          inputMode={props.inputMode}
          maxLength={props.maxLength}
          name={props.label.toLowerCase().replace(/\W+/g, "-")}
          onChange={(event) => {
            props.onChange(event.currentTarget.value);
          }}
          placeholder={props.placeholder}
          spellCheck={false}
          type={props.type ?? "text"}
          value={props.value}
        />
      </div>
    </label>
  );
}

/**
 * Render the shared auth shell chrome used for setup/login screens.
 * @param props - Shell container props for title, error, and footer.
 */
export function AuthConsoleShell(props: {
  children?: ReactNode;
  error: string;
  footer?: JSX.Element | null;
  size?: "sm" | "md" | "lg" | "xl";
  subtitle?: string;
  title: string;
}): JSX.Element {
  const maxWidth =
    props.size === "xl"
      ? "max-w-4xl"
      : props.size === "lg"
        ? "max-w-lg"
        : props.size === "sm"
          ? "max-w-sm"
          : "max-w-md";

  return (
    <main className="relative flex min-h-full flex-col items-center justify-center overflow-auto bg-bg-app px-4 py-12 text-text-primary">
      <div className="pointer-events-none absolute inset-0 bg-bg-canvas/40" />
      <div className={`relative w-full ${maxWidth}`}>
        <div className="border border-border-default bg-bg-canvas">
          <div className="border-b border-border-subtle px-7 py-5">
            <h1 className="text-[1.05rem] font-semibold text-text-primary">
              {props.title}
            </h1>
            {props.subtitle ? (
              <p className="mt-1.5 text-sm leading-6 text-text-muted">
                {props.subtitle}
              </p>
            ) : null}
          </div>

          {props.error ? (
            <div className="border-b border-danger-border bg-danger-surface px-7 py-3 text-sm leading-6 text-danger-text">
              {props.error}
            </div>
          ) : null}

          <div className="px-7 py-7">{props.children}</div>

          {props.footer ? (
            <div className="border-t border-border-subtle px-7 py-5">
              {props.footer}
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}

/**
 * Render authentication flows (setup/login/recovery) and return the active shell.
 * @param connectRpcTransport - Connect callback for authenticated RPC session.
 * @param disconnectRpcTransport - Disconnect callback for teardown.
 * @param procedures - Auth RPC procedures for status and actions.
 */
export default function AuthShell({
  connectRpcTransport,
  disconnectRpcTransport,
  procedures,
}: AuthShellProps): JSX.Element {
  const [view, setView] = useState<AuthView>("loading");
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState("");
  const [setupPrimaryFactorType, setSetupPrimaryFactorType] = useState<
    "password" | "pin"
  >("pin");
  const [setupPrimaryFactor, setSetupPrimaryFactor] = useState("");
  const [setupTotpCode, setSetupTotpCode] = useState("");
  const [loginPrimaryFactor, setLoginPrimaryFactor] = useState("");
  const [loginRecoveryCode, setLoginRecoveryCode] = useState("");
  const [loginTotpCode, setLoginTotpCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [loadingMessage, setLoadingMessage] = useState(
    "Checking local authorization state…",
  );
  const [isBusy, setIsBusy] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState("");
  const loadGateRequestIdRef = useRef(0);

  const lockedUntilLabel = useMemo(
    () => formatDateTime(status?.lockedUntil ?? null),
    [status],
  );
  const loginPrimaryFactorIsPin =
    status?.authenticated === true && status.primaryFactorType === "pin";
  const loginFactorLabel = loginPrimaryFactorIsPin ? "PIN" : "Primary factor";

  const loadGateState = useCallback(
    async (options?: { preserveError?: boolean }) => {
      const requestId = loadGateRequestIdRef.current + 1;
      loadGateRequestIdRef.current = requestId;
      setView("loading");
      setLoadingMessage("Checking local authorization state…");
      if (!options?.preserveError) {
        setError("");
      }

      try {
        const gate = await resolveAuthShellGate({
          connectRpcTransport,
          disconnectRpcTransport,
          getAuthStatus,
          onAuthenticatedConnectRetry: ({ nextAttemptNumber, maxAttempts }) => {
            if (loadGateRequestIdRef.current !== requestId) {
              return;
            }
            setLoadingMessage(
              `Opening authenticated workspace… retrying connection (${nextAttemptNumber}/${maxAttempts})…`,
            );
          },
          onAuthenticatedConnectStart: () => {
            if (loadGateRequestIdRef.current !== requestId) {
              return;
            }
            setLoadingMessage("Opening authenticated workspace…");
          },
        });
        if (loadGateRequestIdRef.current !== requestId) {
          return;
        }
        setStatus(gate.status);

        if (gate.kind === "authenticated") {
          setView("app");
          return;
        }

        disconnectRpcTransport();
        if (gate.kind === "setup") {
          if (gate.notice) {
            setError(gate.notice);
          }
          setLoadingMessage("Preparing first-run setup…");
          setEnrollment(null);
          setSetupPrimaryFactor("");
          setSetupTotpCode("");
          setRecoveryCodes([]);
          setCopyFeedback("");
          setView("setup");
          return;
        }

        if (gate.notice) {
          setError(gate.notice);
        }
        setLoginPrimaryFactor("");
        setLoginRecoveryCode("");
        setLoginTotpCode("");
        setView("login");
      } catch (nextError) {
        if (loadGateRequestIdRef.current !== requestId) {
          return;
        }
        disconnectRpcTransport();
        setError(errorMessage(nextError));
      }
    },
    [connectRpcTransport, disconnectRpcTransport],
  );

  useEffect(() => {
    void loadGateState();
  }, [loadGateState]);

  useEffect(() => {
    /**
     * Handle an auth-required event emitted from backend procedures.
     * @param event - Auth-required custom event payload.
     */
    const handleAuthRequired = (
      event: WindowEventMap["metidos:auth-required"],
    ): void => {
      setError(event.detail.reason);
      void loadGateState({
        preserveError: true,
      });
    };

    window.addEventListener(AUTH_REQUIRED_EVENT_NAME, handleAuthRequired);
    return () => {
      window.removeEventListener(AUTH_REQUIRED_EVENT_NAME, handleAuthRequired);
    };
  }, [loadGateState]);

  useEffect(() => {
    if (!enrollment?.totpUri) {
      setQrCodeDataUrl("");
      return;
    }

    let canceled = false;
    void import("qrcode")
      .then((module) =>
        module.default.toDataURL(enrollment.totpUri, {
          color: {
            dark: readThemeColor("--color-text-secondary", "white"),
            light: readThemeColor("--color-bg-canvas", "black"),
          },
          errorCorrectionLevel: "M",
          margin: 1,
          scale: 8,
        }),
      )
      .then(
        (dataUrl) => {
          if (!canceled) {
            setQrCodeDataUrl(dataUrl);
          }
        },
        () => {
          if (!canceled) {
            setQrCodeDataUrl("");
          }
        },
      );

    return () => {
      canceled = true;
    };
  }, [enrollment?.totpUri]);

  const handlePrepareSetupEnrollment = useCallback(async () => {
    setIsBusy(true);
    setError("");
    try {
      const nextEnrollment = await prepareSetupEnrollment();
      setEnrollment(nextEnrollment);
    } catch (nextError) {
      setEnrollment(null);
      setError(errorMessage(nextError));
    } finally {
      setIsBusy(false);
    }
  }, []);

  const handleSetupSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!enrollment) {
        setError("TOTP enrollment material is not ready yet.");
        return;
      }

      setIsBusy(true);
      setError("");
      setCopyFeedback("");
      try {
        const result = await completeAuthSetup({
          primaryFactor: setupPrimaryFactor,
          primaryFactorType: status?.configured
            ? "pin"
            : setupPrimaryFactorType,
          sessionLifetimeDays: SESSION_LIFETIME_DAYS,
          totpCode: setupTotpCode,
          totpSecret: enrollment.totpSecret,
        });
        setStatus(result.status);
        setRecoveryCodes(result.recoveryCodes);
        setView("recovery");
      } catch (nextError) {
        setError(errorMessage(nextError));
        if (
          nextError instanceof AuthApiError &&
          nextError.code === "auth_already_configured"
        ) {
          void loadGateState({
            preserveError: true,
          });
        }
      } finally {
        setIsBusy(false);
      }
    },
    [
      enrollment,
      loadGateState,
      setupPrimaryFactor,
      setupPrimaryFactorType,
      setupTotpCode,
      status?.configured,
    ],
  );

  const handleLoginSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setIsBusy(true);
      setError("");
      try {
        await loginAuth({
          primaryFactor: loginPrimaryFactor,
          totpCode: loginTotpCode,
        });
        await loadGateState();
      } catch (nextError) {
        if (
          nextError instanceof AuthApiError &&
          nextError.code === "totp_setup_required"
        ) {
          setError("");
          setEnrollment(null);
          setSetupPrimaryFactorType("pin");
          setSetupPrimaryFactor(loginPrimaryFactor.replace(/\D+/g, ""));
          setSetupTotpCode("");
          setView("setup");
          try {
            const nextEnrollment = await prepareSetupEnrollment();
            setEnrollment(nextEnrollment);
          } catch (enrollmentError) {
            setError(errorMessage(enrollmentError));
          }
          return;
        }
        setError(errorMessage(nextError));
        const lockedUntil = readLockedUntil(status, nextError);
        setStatus((current) =>
          current
            ? {
                ...current,
                lockedUntil,
              }
            : current,
        );
      } finally {
        setIsBusy(false);
      }
    },
    [loadGateState, loginPrimaryFactor, loginTotpCode, status],
  );

  const handleRecoveryLoginSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setIsBusy(true);
      setError("");
      try {
        await loginWithRecoveryCodeAuth({
          primaryFactor: loginPrimaryFactor,
          recoveryCode: loginRecoveryCode,
        });
        await loadGateState();
      } catch (nextError) {
        setError(errorMessage(nextError));
        const lockedUntil = readLockedUntil(status, nextError);
        setStatus((current) =>
          current
            ? {
                ...current,
                lockedUntil,
              }
            : current,
        );
      } finally {
        setIsBusy(false);
      }
    },
    [loadGateState, loginPrimaryFactor, loginRecoveryCode, status],
  );

  const handleRecoveryContinue = useCallback(async () => {
    setIsBusy(true);
    setError("");
    try {
      await loadGateState();
    } finally {
      setIsBusy(false);
    }
  }, [loadGateState]);

  const handleCopyRecoveryCodes = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(recoveryCodes.join("\n"));
      setCopyFeedback("Recovery codes copied to the clipboard.");
    } catch {
      setCopyFeedback("Clipboard access failed. Copy the codes manually.");
    }
  }, [recoveryCodes]);

  if (view === "app" && status?.authenticated) {
    return <App isAdmin={status.isAdmin ?? false} procedures={procedures} />;
  }

  if (view === "loading") {
    return AuthConsoleShell({
      children: (
        <div className="space-y-4">
          <div className="h-0.5 w-full overflow-hidden bg-surface-2">
            <div className="h-full w-1/3 animate-pulse bg-accent" />
          </div>
          <p className="text-sm leading-6 text-text-muted">{loadingMessage}</p>
        </div>
      ),
      error,
      footer: error ? (
        <AuthActionButton
          onClick={() => {
            void loadGateState();
          }}
          variant="secondary"
        >
          Retry
        </AuthActionButton>
      ) : null,
      title: "Checking authorization…",
    });
  }

  if (view === "setup") {
    return AuthConsoleShell({
      children: (
        <form className="space-y-6" onSubmit={handleSetupSubmit}>
          {status?.configured ? (
            <div className="border border-border-default bg-surface-1 px-4 py-3 text-sm leading-6 text-text-secondary">
              Finish local sign-in with your existing PIN or passphrase, then
              enroll your authenticator app.
            </div>
          ) : null}

          <div className="flex gap-5">
            <div className="flex-shrink-0">
              {qrCodeDataUrl ? (
                <img
                  alt="TOTP enrollment QR code"
                  className="w-[140px] border border-border-default"
                  src={qrCodeDataUrl}
                />
              ) : (
                <div className="flex h-[140px] w-[140px] items-center justify-center border border-dashed border-border-default bg-surface-1 text-center text-xs leading-5 text-text-faint">
                  Generate a QR code to enroll your authenticator app.
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[10px] tracking-[0.22em] text-accent uppercase">
                Manual entry
              </p>
              <p className="mt-2 break-all font-mono text-xs leading-6 text-text-secondary">
                {enrollment?.totpSecret ?? "No TOTP secret generated yet."}
              </p>
              <p className="mt-2 text-xs text-accent">
                Use only if QR scan fails.
              </p>
            </div>
          </div>

          <AuthActionButton
            disabled={isBusy}
            onClick={() => {
              void handlePrepareSetupEnrollment();
            }}
            variant="secondary"
            wide
          >
            {isBusy
              ? "Preparing…"
              : enrollment
                ? "Regenerate authenticator code"
                : "Generate authenticator code"}
          </AuthActionButton>

          {!status?.configured ? (
            <div>
              <p className="mb-3 font-mono text-[10px] tracking-[0.22em] text-accent uppercase">
                Primary factor
              </p>
              <div className="grid grid-cols-2 gap-3">
                <AuthChoiceButton
                  active={setupPrimaryFactorType === "pin"}
                  body="6+ digits, no obvious runs"
                  onClick={() => {
                    setSetupPrimaryFactorType("pin");
                    setSetupPrimaryFactor("");
                  }}
                  title="PIN"
                />
                <AuthChoiceButton
                  active={setupPrimaryFactorType === "password"}
                  body="12+ character passphrase"
                  onClick={() => {
                    setSetupPrimaryFactorType("password");
                    setSetupPrimaryFactor("");
                  }}
                  title="Passphrase"
                />
              </div>
            </div>
          ) : null}

          <AuthInput
            label={
              status?.configured
                ? "Primary factor"
                : setupPrimaryFactorType === "pin"
                  ? "Set PIN"
                  : "Set passphrase"
            }
            autoComplete={
              status?.configured ? "current-password" : "new-password"
            }
            inputMode={
              status?.configured || setupPrimaryFactorType === "pin"
                ? "numeric"
                : "text"
            }
            monospace={status?.configured || setupPrimaryFactorType === "pin"}
            onChange={(value) => {
              setSetupPrimaryFactor(
                status?.configured || setupPrimaryFactorType === "pin"
                  ? value.replace(/\D+/g, "")
                  : value,
              );
            }}
            placeholder={
              status?.configured
                ? "Enter your current PIN or passphrase"
                : setupPrimaryFactorType === "pin"
                  ? "Enter 6+ non-obvious digits"
                  : "Enter 12+ character passphrase"
            }
            type="password"
            value={setupPrimaryFactor}
          />
          <AuthInput
            autoComplete="one-time-code"
            inputMode="numeric"
            label="TOTP code"
            maxLength={6}
            monospace
            onChange={(value) => {
              setSetupTotpCode(value.replace(/\D+/g, ""));
            }}
            placeholder="Enter current 6-digit code"
            type="text"
            value={setupTotpCode}
          />

          <AuthActionButton
            disabled={isBusy || !enrollment}
            type="submit"
            variant="primary"
            wide
          >
            {isBusy ? "Finishing setup…" : "Complete setup"}
          </AuthActionButton>
        </form>
      ),
      error,
      size: "md",
      subtitle: status?.configured
        ? "Scan the QR code with your authenticator app, then confirm the current code to finish local sign-in."
        : "Scan the QR code with your authenticator app, then finish setting up this local Metidos installation.",
      title: "Set up Metidos",
    });
  }

  if (view === "recovery") {
    return AuthConsoleShell({
      children: (
        <div className="space-y-5">
          <p className="text-sm leading-6 text-text-muted">
            Store these codes somewhere safe outside the browser. This is the
            only time they will be shown.
          </p>
          <div className="grid grid-cols-2 gap-2">
            {recoveryCodes.map((code) => (
              <div
                className="border border-border-default bg-surface-1 px-3 py-2 font-mono text-sm tracking-[0.12em] text-text-secondary"
                key={code}
              >
                {code}
              </div>
            ))}
          </div>
          {copyFeedback ? (
            <div className="border border-border-default bg-surface-2 px-4 py-3 text-sm text-text-secondary">
              {copyFeedback}
            </div>
          ) : null}
        </div>
      ),
      error,
      footer: (
        <div className="flex flex-col gap-3 sm:flex-row">
          <AuthActionButton
            onClick={() => {
              void handleCopyRecoveryCodes();
            }}
            variant="secondary"
          >
            Copy codes
          </AuthActionButton>
          <AuthActionButton
            disabled={isBusy}
            onClick={() => {
              void handleRecoveryContinue();
            }}
            variant="primary"
          >
            {isBusy ? "Opening workspace…" : "I stored them, continue"}
          </AuthActionButton>
        </div>
      ),
      size: "md",
      subtitle:
        "Each code is single-use. They cannot be recovered after this screen.",
      title: "Save your recovery codes",
    });
  }

  if (view === "recovery-login") {
    return AuthConsoleShell({
      children: (
        <form className="space-y-5" onSubmit={handleRecoveryLoginSubmit}>
          <AuthInput
            autoComplete="current-password"
            inputMode={loginPrimaryFactorIsPin ? "numeric" : "text"}
            label={loginFactorLabel}
            monospace={loginPrimaryFactorIsPin}
            onChange={(value) => {
              setLoginPrimaryFactor(
                loginPrimaryFactorIsPin ? value.replace(/\D+/g, "") : value,
              );
            }}
            placeholder="Enter your PIN or password"
            type="password"
            value={loginPrimaryFactor}
          />
          <AuthInput
            autoComplete="off"
            label="Recovery code"
            monospace
            onChange={(value) => {
              setLoginRecoveryCode(value.toUpperCase().replace(/\s+/g, ""));
            }}
            placeholder="Enter one unused recovery code"
            type="text"
            value={loginRecoveryCode}
          />
          <AuthActionButton
            disabled={isBusy}
            type="submit"
            variant="primary"
            wide
          >
            {isBusy ? "Signing in…" : "Unlock with recovery code"}
          </AuthActionButton>
        </form>
      ),
      error,
      footer: (
        <div className="space-y-3">
          {lockedUntilLabel ? (
            <div className="border border-warning-border bg-warning-surface px-4 py-3 text-sm text-warning-text">
              Locked until {lockedUntilLabel}.
            </div>
          ) : null}
          <AuthActionButton
            disabled={isBusy}
            onClick={() => {
              setError("");
              setLoginRecoveryCode("");
              setLoginTotpCode("");
              setLoginPrimaryFactor("");
              setView("login");
            }}
            variant="secondary"
          >
            Back to TOTP login
          </AuthActionButton>
        </div>
      ),
      subtitle: "Use your primary factor and one unused recovery code.",
      title: "Recovery sign-in",
    });
  }

  return AuthConsoleShell({
    title: "Sign in to Metidos",
    children: (
      <form
        className="space-y-5 border border-border-default bg-bg-canvas px-6 py-6"
        onSubmit={handleLoginSubmit}
      >
        <AuthInput
          autoComplete="current-password"
          inputMode={loginPrimaryFactorIsPin ? "numeric" : "text"}
          label={loginFactorLabel}
          monospace={loginPrimaryFactorIsPin}
          onChange={(value) => {
            setLoginPrimaryFactor(
              loginPrimaryFactorIsPin ? value.replace(/\D+/g, "") : value,
            );
          }}
          placeholder="Enter your PIN or password"
          type="password"
          value={loginPrimaryFactor}
        />
        <AuthInput
          autoComplete="one-time-code"
          inputMode="numeric"
          label="TOTP code"
          maxLength={6}
          monospace
          onChange={(value) => {
            setLoginTotpCode(value.replace(/\D+/g, ""));
          }}
          placeholder="Enter the current 6-digit code"
          type="text"
          value={loginTotpCode}
        />
        <div className="text-sm leading-6 text-text-muted">
          Leave the TOTP field blank the first time you sign in after setting a
          PIN or passphrase. After the primary factor is verified, you will
          finish authenticator setup.
        </div>

        <AuthActionButton
          disabled={isBusy}
          type="submit"
          variant="primary"
          wide
        >
          {isBusy ? "Continuing..." : "Continue"}
        </AuthActionButton>

        <AuthActionButton
          disabled={isBusy}
          onClick={() => {
            setError("");
            setLoginTotpCode("");
            setLoginRecoveryCode("");
            setLoginPrimaryFactor("");
            setView("recovery-login");
          }}
          variant="secondary"
          wide
        >
          Use a recovery code instead
        </AuthActionButton>
      </form>
    ),
    error,
    size: "md",
    footer: lockedUntilLabel ? (
      <div className="border border-warning-border bg-warning-surface px-4 py-3 text-sm leading-7 text-warning-text">
        Too many failed attempts. Login is locked until {lockedUntilLabel}.
      </div>
    ) : null,
  });
}
