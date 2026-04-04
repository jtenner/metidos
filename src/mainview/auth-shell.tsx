import QRCode from "qrcode";
import {
  type FormEvent,
  type JSX,
  useCallback,
  useEffect,
  useMemo,
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
  logoutAuth,
  prepareSetupEnrollment,
  type TotpEnrollment,
} from "./auth-client";
import { connectRpcTransportWithRetry } from "./auth-shell-connect";

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

function formatDateTime(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return null;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

function errorMessage(error: unknown): string {
  if (error instanceof AuthApiError) {
    return error.message;
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  return "An unexpected authentication error occurred.";
}

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

function AuthActionButton(props: {
  children: JSX.Element | string;
  disabled?: boolean;
  onClick?: () => void;
  type?: "button" | "submit";
  variant: "primary" | "secondary";
  wide?: boolean;
}): JSX.Element {
  return (
    <button
      className={`${
        props.wide ? "w-full" : ""
      } border px-5 py-4 font-label text-[11px] font-semibold tracking-[0.2em] uppercase transition disabled:cursor-not-allowed disabled:border-[#21313d] disabled:bg-[#0a131b] disabled:text-[#50616f] ${
        props.variant === "primary"
          ? "border-[#d1deea] bg-[#c4d0dd] text-[#08111a] hover:bg-[#d7e1ea]"
          : "border-[#20323f] bg-[#08131c] text-[#9fb2c2] hover:border-[#3a5567] hover:text-[#e8f1f9]"
      }`}
      disabled={props.disabled}
      onClick={props.onClick}
      type={props.type ?? "button"}
    >
      {props.children}
    </button>
  );
}

function AuthChoiceButton(props: {
  active: boolean;
  body: string;
  onClick: () => void;
  title: string;
}): JSX.Element {
  return (
    <button
      className={
        props.active
          ? "border border-[#b7c6d5] bg-[#445668] px-5 py-5 text-left transition hover:bg-[#4b6072]"
          : "border border-[#20323f] bg-[#07131c] px-5 py-5 text-left text-[#8ca0b0] transition hover:border-[#3a5567] hover:text-[#e8f1f9]"
      }
      onClick={props.onClick}
      type="button"
    >
      <div className="font-label text-[11px] font-semibold tracking-[0.2em] text-inherit uppercase">
        {props.title}
      </div>
      <div
        className={`mt-2 text-sm leading-6 ${
          props.active ? "text-[#edf4fa]" : "text-[#7890a2]"
        }`}
      >
        {props.body}
      </div>
    </button>
  );
}

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
      <span className="font-mono text-[11px] tracking-[0.22em] text-[#668093] uppercase">
        {props.label}
      </span>
      <div className="mt-4 border border-[#20323f] bg-[#08131c] px-4 py-3 transition focus-within:border-[#88a3b7] focus-within:bg-[#0d1821]">
        <input
          autoComplete={props.autoComplete}
          className={`w-full bg-transparent text-base text-[#edf4fa] outline-none placeholder:text-[#4c6474] ${
            props.monospace ? "font-mono tracking-[0.16em]" : ""
          }`}
          inputMode={props.inputMode}
          maxLength={props.maxLength}
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

function authConsoleShell(props: {
  children: JSX.Element;
  error: string;
  footer?: JSX.Element | null;
  size?: "sm" | "md" | "lg";
  subtitle?: string;
  title: string;
}): JSX.Element {
  const maxWidth =
    props.size === "lg"
      ? "max-w-lg"
      : props.size === "sm"
        ? "max-w-sm"
        : "max-w-md";

  return (
    <main className="relative flex min-h-full flex-col items-center justify-center overflow-auto bg-[#040b11] px-4 py-12 text-[#e8eef5]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(62,105,142,0.16),_transparent_34%),radial-gradient(circle_at_bottom_right,_rgba(88,126,158,0.12),_transparent_32%),linear-gradient(180deg,_#06111a_0%,_#04090f_58%,_#03070b_100%)]" />
      <div className={`relative w-full ${maxWidth}`}>
        <div className="border border-[#162733] bg-[#060f17]">
          <div className="border-b border-[#162733] px-7 py-5">
            <h1 className="text-[1.05rem] font-semibold tracking-[-0.02em] text-[#edf4fa]">
              {props.title}
            </h1>
            {props.subtitle ? (
              <p className="mt-1.5 text-sm leading-6 text-[#6a8799]">
                {props.subtitle}
              </p>
            ) : null}
          </div>

          {props.error ? (
            <div className="border-b border-[#4c2820] bg-[#1a0a08] px-7 py-3.5 text-sm leading-6 text-[#efb6a9]">
              {props.error}
            </div>
          ) : null}

          <div className="px-7 py-7">{props.children}</div>

          {props.footer ? (
            <div className="border-t border-[#162733] px-7 py-5">
              {props.footer}
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}

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

  const lockedUntilLabel = useMemo(
    () => formatDateTime(status?.lockedUntil ?? null),
    [status],
  );
  const sessionExpiresLabel = useMemo(
    () => formatDateTime(status?.sessionExpiresAt ?? null),
    [status],
  );
  const loginFactorLabel =
    status?.primaryFactorType === "pin" ? "PIN" : "Password";

  const loadGateState = useCallback(
    async (options?: { preserveError?: boolean }) => {
      setView("loading");
      setLoadingMessage("Checking local authorization state…");
      if (!options?.preserveError) {
        setError("");
      }

      try {
        const nextStatus = await getAuthStatus();
        setStatus(nextStatus);

        if (nextStatus.authenticated) {
          setLoadingMessage("Opening authenticated workspace…");
          await connectRpcTransportWithRetry({
            connect: connectRpcTransport,
            onRetry: ({ nextAttemptNumber, maxAttempts }) => {
              setLoadingMessage(
                `Opening authenticated workspace… retrying connection (${nextAttemptNumber}/${maxAttempts})…`,
              );
            },
          });
          setView("app");
          return;
        }

        disconnectRpcTransport();
        if (!nextStatus.configured) {
          setLoadingMessage("Preparing first-run setup…");
          setEnrollment(await prepareSetupEnrollment());
          setSetupPrimaryFactor("");
          setSetupTotpCode("");
          setRecoveryCodes([]);
          setCopyFeedback("");
          setView("setup");
          return;
        }

        setLoginPrimaryFactor("");
        setLoginRecoveryCode("");
        setLoginTotpCode("");
        setView("login");
      } catch (nextError) {
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
    const handleAuthRequired = (
      event: WindowEventMap["jolt:auth-required"],
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
    void QRCode.toDataURL(enrollment.totpUri, {
      color: {
        dark: "#dbe9f2",
        light: "#0b1014",
      },
      errorCorrectionLevel: "M",
      margin: 1,
      scale: 8,
    }).then(
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
          primaryFactorType: setupPrimaryFactorType,
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
    ],
  );

  const handleLoginSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setIsBusy(true);
      setError("");
      try {
        const result = await loginAuth({
          primaryFactor: loginPrimaryFactor,
          totpCode: loginTotpCode,
        });
        setStatus(result.status);
        await connectRpcTransport();
        setView("app");
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
    [connectRpcTransport, loginPrimaryFactor, loginTotpCode, status],
  );

  const handleRecoveryLoginSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setIsBusy(true);
      setError("");
      try {
        const result = await loginWithRecoveryCodeAuth({
          primaryFactor: loginPrimaryFactor,
          recoveryCode: loginRecoveryCode,
        });
        setStatus(result.status);
        await connectRpcTransport();
        setView("app");
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
    [connectRpcTransport, loginPrimaryFactor, loginRecoveryCode, status],
  );

  const handleRecoveryContinue = useCallback(async () => {
    setIsBusy(true);
    setError("");
    try {
      await connectRpcTransport();
      setView("app");
    } catch (nextError) {
      setError(errorMessage(nextError));
      await loadGateState({
        preserveError: true,
      });
    } finally {
      setIsBusy(false);
    }
  }, [connectRpcTransport, loadGateState]);

  const handleCopyRecoveryCodes = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(recoveryCodes.join("\n"));
      setCopyFeedback("Recovery codes copied to the clipboard.");
    } catch {
      setCopyFeedback("Clipboard access failed. Copy the codes manually.");
    }
  }, [recoveryCodes]);

  const handleLogout = useCallback(async () => {
    setIsBusy(true);
    setError("");
    try {
      const nextStatus = await logoutAuth();
      setStatus(nextStatus);
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      disconnectRpcTransport();
      setIsBusy(false);
      await loadGateState({
        preserveError: true,
      });
    }
  }, [disconnectRpcTransport, loadGateState]);

  if (view === "app" && status?.authenticated) {
    const devBypassMessage = status.configured
      ? "Stored local auth remains configured, but this session is bypassing login checks."
      : "No local auth is configured right now. Disable JOLT_DEV_BYPASS=1 before validating the real setup/login flow.";

    return (
      <div className="relative h-full">
        <div className="pointer-events-none absolute right-4 top-4 z-50 flex justify-end">
          <div className="pointer-events-auto flex items-center gap-3 border border-[#22303a] bg-[#0b1115]/92 px-3 py-2 text-xs text-[#ced6dc] shadow-[0_12px_32px_rgba(0,0,0,0.34)] backdrop-blur-xl">
            {status.devBypass ? (
              <span className="border border-[#6c5134] bg-[#332111] px-2 py-1 font-label text-[10px] font-semibold tracking-[0.16em] text-[#f4c996] uppercase">
                Dev auth bypass
              </span>
            ) : null}
            {sessionExpiresLabel ? (
              <span className="hidden text-[#8da3b4] md:inline">
                Session expires {sessionExpiresLabel}
              </span>
            ) : null}
            <button
              className="border border-[#304350] bg-[#162029] px-3 py-1.5 font-label text-[10px] font-semibold tracking-[0.16em] text-[#dbe9f2] uppercase transition hover:border-[#6aa6cc] hover:bg-[#1a2933]"
              disabled={isBusy || status.devBypass}
              onClick={() => {
                void handleLogout();
              }}
              type="button"
            >
              {status.devBypass
                ? "Bypass active"
                : isBusy
                  ? "Locking…"
                  : "Lock app"}
            </button>
          </div>
        </div>
        {status.devBypass ? (
          <div className="pointer-events-none absolute left-4 top-4 z-40 max-w-md">
            <div className="pointer-events-auto border border-[#6c5134] bg-[#20150c]/95 px-4 py-3 text-xs leading-5 text-[#f4c996] shadow-[0_12px_32px_rgba(0,0,0,0.34)] backdrop-blur-xl">
              <div className="font-label text-[10px] font-semibold tracking-[0.18em] text-[#f6d9ac] uppercase">
                Dev-only access path
              </div>
              <div className="mt-1.5">{devBypassMessage}</div>
            </div>
          </div>
        ) : null}
        <App
          primaryFactorType={status.primaryFactorType}
          procedures={procedures}
        />
      </div>
    );
  }

  if (view === "loading") {
    return authConsoleShell({
      children: (
        <div className="space-y-4">
          <div className="h-0.5 w-full overflow-hidden bg-[#0d1e2b]">
            <div className="h-full w-1/3 animate-pulse bg-[#4a7fa0]" />
          </div>
          <p className="text-sm leading-6 text-[#6a8799]">{loadingMessage}</p>
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
    return authConsoleShell({
      children: (
        <form className="space-y-6" onSubmit={handleSetupSubmit}>
          <div className="flex gap-5">
            <div className="flex-shrink-0">
              {qrCodeDataUrl ? (
                <img
                  alt="TOTP enrollment QR code"
                  className="w-[140px] border border-[#1d3347]"
                  src={qrCodeDataUrl}
                />
              ) : (
                <div className="flex h-[140px] w-[140px] items-center justify-center border border-dashed border-[#29404e] bg-[#09121a] text-center text-xs leading-5 text-[#546e80]">
                  Generating…
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[10px] tracking-[0.22em] text-[#4d7a95] uppercase">
                Manual entry
              </p>
              <p className="mt-2 break-all font-mono text-xs leading-6 text-[#aec8d8]">
                {enrollment?.totpSecret ?? "Preparing…"}
              </p>
              <p className="mt-2 text-xs text-[#4d7a95]">
                Use only if QR scan fails.
              </p>
            </div>
          </div>

          <div>
            <p className="mb-3 font-mono text-[10px] tracking-[0.22em] text-[#4d7a95] uppercase">
              Primary factor
            </p>
            <div className="grid grid-cols-2 gap-3">
              <AuthChoiceButton
                active={setupPrimaryFactorType === "pin"}
                body="6+ digits"
                onClick={() => {
                  setSetupPrimaryFactorType("pin");
                  setSetupPrimaryFactor("");
                }}
                title="PIN"
              />
              <AuthChoiceButton
                active={setupPrimaryFactorType === "password"}
                body="Any passphrase"
                onClick={() => {
                  setSetupPrimaryFactorType("password");
                  setSetupPrimaryFactor("");
                }}
                title="Passphrase"
              />
            </div>
          </div>

          <AuthInput
            autoComplete="new-password"
            inputMode={setupPrimaryFactorType === "pin" ? "numeric" : "text"}
            label={
              setupPrimaryFactorType === "pin" ? "Set PIN" : "Set passphrase"
            }
            monospace={setupPrimaryFactorType === "pin"}
            onChange={(value) => {
              setSetupPrimaryFactor(
                setupPrimaryFactorType === "pin"
                  ? value.replace(/\D+/g, "")
                  : value,
              );
            }}
            placeholder={
              setupPrimaryFactorType === "pin"
                ? "Enter 6+ digits"
                : "Enter passphrase"
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
      subtitle:
        "Scan the QR code with your authenticator app, then complete the form below.",
      title: "First-run setup",
    });
  }

  if (view === "recovery") {
    return authConsoleShell({
      children: (
        <div className="space-y-5">
          <p className="text-sm leading-6 text-[#6a8799]">
            Store these codes somewhere safe outside the browser. This is the
            only time they will be shown.
          </p>
          <div className="grid grid-cols-2 gap-2">
            {recoveryCodes.map((code) => (
              <div
                className="border border-[#1d3347] bg-[#08131c] px-3 py-2.5 font-mono text-sm tracking-[0.12em] text-[#cde0ed]"
                key={code}
              >
                {code}
              </div>
            ))}
          </div>
          {copyFeedback ? (
            <div className="border border-[#284155] bg-[#0b1822] px-4 py-3 text-sm text-[#b6d0e2]">
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
    return authConsoleShell({
      children: (
        <form className="space-y-5" onSubmit={handleRecoveryLoginSubmit}>
          <AuthInput
            autoComplete="current-password"
            inputMode={status?.primaryFactorType === "pin" ? "numeric" : "text"}
            label={loginFactorLabel}
            monospace={status?.primaryFactorType === "pin"}
            onChange={(value) => {
              setLoginPrimaryFactor(
                status?.primaryFactorType === "pin"
                  ? value.replace(/\D+/g, "")
                  : value,
              );
            }}
            placeholder={
              status?.primaryFactorType === "pin"
                ? "Enter your PIN"
                : "Enter your passphrase"
            }
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
            <div className="border border-[#503526] bg-[#1a0e09] px-4 py-3 text-sm text-[#efc092]">
              Locked until {lockedUntilLabel}.
            </div>
          ) : null}
          <AuthActionButton
            disabled={isBusy}
            onClick={() => {
              setError("");
              setLoginRecoveryCode("");
              setLoginTotpCode("");
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

  return authConsoleShell({
    title: "Set Password or Pin",
    children: (
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <form
          className="space-y-5 border border-[#162733] bg-[#06111a] px-6 py-6"
          onSubmit={handleLoginSubmit}
        >
          <AuthInput
            autoComplete="current-password"
            inputMode={status?.primaryFactorType === "pin" ? "numeric" : "text"}
            label={loginFactorLabel}
            monospace={status?.primaryFactorType === "pin"}
            onChange={(value) => {
              setLoginPrimaryFactor(
                status?.primaryFactorType === "pin"
                  ? value.replace(/\D+/g, "")
                  : value,
              );
            }}
            placeholder={
              status?.primaryFactorType === "pin"
                ? "Enter your PIN"
                : "Enter your password or passphrase"
            }
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

          <AuthActionButton
            disabled={isBusy}
            type="submit"
            variant="primary"
            wide
          >
            {isBusy ? "Signing in..." : "Unlock workspace"}
          </AuthActionButton>

          <AuthActionButton
            disabled={isBusy}
            onClick={() => {
              setError("");
              setLoginTotpCode("");
              setLoginRecoveryCode("");
              setView("recovery-login");
            }}
            variant="secondary"
            wide
          >
            Use a recovery code instead
          </AuthActionButton>
        </form>

        <div className="space-y-5">
          <div className="border border-[#162733] bg-[#0a1620] px-5 py-5">
            <div className="font-mono text-[11px] tracking-[0.22em] text-[#688093] uppercase">
              Active policy
            </div>
            <div className="mt-4 text-sm leading-7 text-[#8ea5b6]">
              Every login requires the configured{" "}
              {loginFactorLabel.toLowerCase()} plus the current TOTP code from
              your authenticator app.
            </div>
          </div>

          <div className="border border-[#162733] bg-[#06111a] px-5 py-5">
            <div className="font-mono text-[11px] tracking-[0.22em] text-[#688093] uppercase">
              Session scope
            </div>
            <div className="mt-4 text-sm leading-7 text-[#8ea5b6]">
              Workspace data and RPC transport remain unavailable until the
              sign-in succeeds.
            </div>
          </div>
        </div>
      </div>
    ),
    error,
    footer: lockedUntilLabel ? (
      <div className="border border-[#503526] bg-[#281a13] px-4 py-3 text-sm leading-7 text-[#efc092]">
        Too many failed attempts. Login is locked until {lockedUntilLabel}.
      </div>
    ) : null,
  });
}
