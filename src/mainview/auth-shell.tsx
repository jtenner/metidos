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
  logoutAuth,
  prepareSetupEnrollment,
  type TotpEnrollment,
} from "./auth-client";

type AuthShellProps = {
  connectRpcTransport: () => Promise<void>;
  disconnectRpcTransport: () => void;
  procedures: ProjectProcedures;
};

type AuthView = "app" | "loading" | "login" | "recovery" | "setup";

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

function authCardShell(children: JSX.Element): JSX.Element {
  return (
    <main className="relative flex min-h-full bg-[#050709] text-[#f3f4f6]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(78,143,193,0.2),_transparent_45%),radial-gradient(circle_at_bottom_right,_rgba(191,111,89,0.16),_transparent_40%),linear-gradient(180deg,_rgba(11,16,21,0.96),_rgba(5,7,9,1))]" />
      <div className="relative flex min-h-full w-full items-center justify-center px-5 py-10">
        <div className="w-full max-w-5xl overflow-hidden border border-[#23303a] bg-[#0d1216]/95 shadow-[0_24px_80px_rgba(0,0,0,0.42)] backdrop-blur-xl">
          <div className="grid min-h-[720px] md:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
            {children}
          </div>
        </div>
      </div>
    </main>
  );
}

function AuthHero(props: {
  eyebrow: string;
  primary: string;
  secondary: string;
  tertiary: string;
}): JSX.Element {
  return (
    <section className="relative overflow-hidden border-b border-[#1d2932] bg-[#0f171d] px-6 py-7 md:border-b-0 md:border-r md:px-10 md:py-10">
      <div className="absolute inset-0 bg-[linear-gradient(160deg,_rgba(85,150,204,0.16),_transparent_32%),linear-gradient(18deg,_rgba(220,119,79,0.12),_transparent_38%)]" />
      <div className="relative space-y-8">
        <div className="space-y-4">
          <div className="inline-flex items-center gap-2 border border-[#2d4252] bg-[#13222c] px-3 py-1 font-mono text-[11px] tracking-[0.22em] text-[#8eb7d2] uppercase">
            <span className="h-2 w-2 rounded-full bg-[#79c3ff]" />
            {props.eyebrow}
          </div>
          <div className="space-y-3">
            <h1 className="max-w-md text-3xl font-semibold tracking-tight text-[#f6f5f4] md:text-4xl">
              Local access is locked behind a real sign-in flow.
            </h1>
            <p className="max-w-lg text-sm leading-6 text-[#a2b5c3] md:text-base">
              Jolt now requires a primary factor plus TOTP before any workspace
              data or RPC actions are available.
            </p>
          </div>
        </div>

        <div className="grid gap-3 text-sm md:max-w-xl">
          <div className="border border-[#21313c] bg-[#101a21] px-4 py-3">
            <div className="font-label text-[10px] font-semibold tracking-[0.18em] text-[#85a9c2] uppercase">
              Primary factor
            </div>
            <div className="mt-1.5 text-[#ebf0f3]">{props.primary}</div>
          </div>
          <div className="border border-[#21313c] bg-[#101a21] px-4 py-3">
            <div className="font-label text-[10px] font-semibold tracking-[0.18em] text-[#85a9c2] uppercase">
              Mandatory TOTP
            </div>
            <div className="mt-1.5 text-[#ebf0f3]">{props.secondary}</div>
          </div>
          <div className="border border-[#21313c] bg-[#101a21] px-4 py-3">
            <div className="font-label text-[10px] font-semibold tracking-[0.18em] text-[#85a9c2] uppercase">
              Recovery handling
            </div>
            <div className="mt-1.5 text-[#ebf0f3]">{props.tertiary}</div>
          </div>
        </div>
      </div>
    </section>
  );
}

function AuthPanel(props: {
  children: JSX.Element;
  error: string;
  footer?: JSX.Element | null;
  title: string;
}): JSX.Element {
  return (
    <section className="flex min-h-full flex-col bg-[#0b1014]">
      <div className="border-b border-[#182028] px-6 py-5 md:px-8">
        <div className="font-label text-[10px] font-semibold tracking-[0.2em] text-[#7f9ab0] uppercase">
          {props.title}
        </div>
      </div>
      <div className="flex flex-1 flex-col px-6 py-6 md:px-8 md:py-8">
        {props.error ? (
          <div className="mb-5 border border-[#4a2520] bg-[#2a1714] px-4 py-3 text-sm text-[#f4b2a7]">
            {props.error}
          </div>
        ) : null}
        <div className="flex-1">{props.children}</div>
        {props.footer ? <div className="mt-6">{props.footer}</div> : null}
      </div>
    </section>
  );
}

function AuthInput(props: {
  autoComplete?: string;
  inputMode?: "numeric" | "text";
  label: string;
  maxLength?: number;
  onChange: (value: string) => void;
  placeholder: string;
  type?: "password" | "text";
  value: string;
}): JSX.Element {
  return (
    <label className="block space-y-2">
      <span className="font-label text-[10px] font-semibold tracking-[0.18em] text-[#7d97ab] uppercase">
        {props.label}
      </span>
      <input
        autoComplete={props.autoComplete}
        className="w-full border border-[#23303a] bg-[#11181d] px-3 py-3 text-sm text-[#f4f6f8] outline-none transition focus:border-[#6aa6cc] focus:bg-[#121c22]"
        inputMode={props.inputMode}
        maxLength={props.maxLength}
        onChange={(event) => {
          props.onChange(event.currentTarget.value);
        }}
        placeholder={props.placeholder}
        type={props.type ?? "text"}
        value={props.value}
      />
    </label>
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
          await connectRpcTransport();
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
    return (
      <div className="relative h-full">
        <div className="pointer-events-none absolute right-4 top-4 z-50 flex justify-end">
          <div className="pointer-events-auto flex items-center gap-3 border border-[#22303a] bg-[#0b1115]/92 px-3 py-2 text-xs text-[#ced6dc] shadow-[0_12px_32px_rgba(0,0,0,0.34)] backdrop-blur-xl">
            {sessionExpiresLabel ? (
              <span className="hidden text-[#8da3b4] md:inline">
                Session expires {sessionExpiresLabel}
              </span>
            ) : null}
            <button
              className="border border-[#304350] bg-[#162029] px-3 py-1.5 font-label text-[10px] font-semibold tracking-[0.16em] text-[#dbe9f2] uppercase transition hover:border-[#6aa6cc] hover:bg-[#1a2933]"
              disabled={isBusy}
              onClick={() => {
                void handleLogout();
              }}
              type="button"
            >
              {isBusy ? "Locking…" : "Lock app"}
            </button>
          </div>
        </div>
        <App procedures={procedures} />
      </div>
    );
  }

  if (view === "loading") {
    return authCardShell(
      <>
        <AuthHero
          eyebrow="Authorization required"
          primary="Choose a local PIN or a master password at setup, then use that factor for every login."
          secondary="Every login also requires a fresh TOTP code from your authenticator app."
          tertiary="Recovery codes are generated once and shown once during enrollment."
        />
        <AuthPanel
          error={error}
          footer={
            <button
              className="border border-[#2a3b47] bg-[#12202a] px-4 py-3 font-label text-[11px] font-semibold tracking-[0.18em] text-[#dbe9f2] uppercase transition hover:border-[#6aa6cc] hover:bg-[#173140]"
              onClick={() => {
                void loadGateState();
              }}
              type="button"
            >
              Retry
            </button>
          }
          title="Access check"
        >
          <div className="flex h-full flex-col justify-center space-y-5">
            <div className="h-1.5 w-full overflow-hidden bg-[#111920]">
              <div className="h-full w-1/3 animate-pulse bg-[#6aa6cc]" />
            </div>
            <div className="space-y-2">
              <div className="text-lg font-semibold text-[#eef2f5]">
                {loadingMessage}
              </div>
              <div className="max-w-md text-sm leading-6 text-[#93a5b2]">
                Jolt is checking whether this local install needs first-run
                setup, a login prompt, or an authenticated session restore.
              </div>
            </div>
          </div>
        </AuthPanel>
      </>,
    );
  }

  if (view === "setup") {
    return authCardShell(
      <>
        <AuthHero
          eyebrow="First-run setup"
          primary="Pick a 6-digit-or-longer PIN, or use a password or passphrase instead."
          secondary="Scan the QR code into your authenticator app, then confirm with a live 6-digit code."
          tertiary="Ten recovery codes are generated after setup and shown one time before workspace access unlocks."
        />
        <AuthPanel
          error={error}
          footer={
            <div className="text-xs leading-5 text-[#8397a6]">
              Session lifetime is fixed to 7 days. The app remains locked until
              setup succeeds.
            </div>
          }
          title="Create local access"
        >
          <div className="space-y-6">
            <div className="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
              <div className="border border-[#22303a] bg-[#0f171d] p-4">
                <div className="font-label text-[10px] font-semibold tracking-[0.18em] text-[#7fa1b9] uppercase">
                  Authenticator QR
                </div>
                <div className="mt-4 flex justify-center">
                  {qrCodeDataUrl ? (
                    <img
                      alt="TOTP enrollment QR code"
                      className="w-full max-w-[180px] border border-[#243641] bg-[#0b1014] p-3"
                      src={qrCodeDataUrl}
                    />
                  ) : (
                    <div className="flex h-[204px] w-[204px] items-center justify-center border border-dashed border-[#29404e] bg-[#0b1014] px-4 text-center text-xs leading-5 text-[#7990a2]">
                      Generating QR code…
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-5">
                <div className="space-y-3">
                  <div className="font-label text-[10px] font-semibold tracking-[0.18em] text-[#7d97ab] uppercase">
                    Choose primary factor
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <button
                      className={
                        setupPrimaryFactorType === "pin"
                          ? "border border-[#6aa6cc] bg-[#13222c] px-4 py-4 text-left text-sm text-[#eef3f6]"
                          : "border border-[#23303a] bg-[#11181d] px-4 py-4 text-left text-sm text-[#aab9c4]"
                      }
                      onClick={() => {
                        setSetupPrimaryFactorType("pin");
                        setSetupPrimaryFactor("");
                      }}
                      type="button"
                    >
                      <div className="font-semibold text-[#eef3f6]">PIN</div>
                      <div className="mt-1 text-xs leading-5 text-[#8ea3b3]">
                        Digits only, minimum length 6.
                      </div>
                    </button>
                    <button
                      className={
                        setupPrimaryFactorType === "password"
                          ? "border border-[#6aa6cc] bg-[#13222c] px-4 py-4 text-left text-sm text-[#eef3f6]"
                          : "border border-[#23303a] bg-[#11181d] px-4 py-4 text-left text-sm text-[#aab9c4]"
                      }
                      onClick={() => {
                        setSetupPrimaryFactorType("password");
                        setSetupPrimaryFactor("");
                      }}
                      type="button"
                    >
                      <div className="font-semibold text-[#eef3f6]">
                        Password / passphrase
                      </div>
                      <div className="mt-1 text-xs leading-5 text-[#8ea3b3]">
                        Any non-empty secret, paired with TOTP.
                      </div>
                    </button>
                  </div>
                </div>

                <form className="space-y-4" onSubmit={handleSetupSubmit}>
                  <AuthInput
                    autoComplete="new-password"
                    inputMode={
                      setupPrimaryFactorType === "pin" ? "numeric" : "text"
                    }
                    label={
                      setupPrimaryFactorType === "pin"
                        ? "PIN"
                        : "Password / passphrase"
                    }
                    onChange={(value) => {
                      setSetupPrimaryFactor(
                        setupPrimaryFactorType === "pin"
                          ? value.replace(/\D+/g, "")
                          : value,
                      );
                    }}
                    placeholder={
                      setupPrimaryFactorType === "pin"
                        ? "Enter a 6-digit or longer PIN"
                        : "Enter a password or passphrase"
                    }
                    type="password"
                    value={setupPrimaryFactor}
                  />
                  <AuthInput
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    label="TOTP code"
                    maxLength={6}
                    onChange={(value) => {
                      setSetupTotpCode(value.replace(/\D+/g, ""));
                    }}
                    placeholder="Enter the current 6-digit code"
                    type="text"
                    value={setupTotpCode}
                  />

                  <div className="space-y-2 border border-[#1d2932] bg-[#0f171d] px-4 py-4">
                    <div className="font-label text-[10px] font-semibold tracking-[0.18em] text-[#7d97ab] uppercase">
                      Manual secret fallback
                    </div>
                    <div className="break-all font-mono text-sm text-[#edf3f7]">
                      {enrollment?.totpSecret ?? "Preparing secret…"}
                    </div>
                    <div className="text-xs leading-5 text-[#879aa8]">
                      If QR scanning is unavailable, add a TOTP account manually
                      with this secret and a 30-second 6-digit SHA-1 profile.
                    </div>
                  </div>

                  <button
                    className="w-full border border-[#6aa6cc] bg-[#173247] px-4 py-3 font-label text-[11px] font-semibold tracking-[0.18em] text-[#f4f7fa] uppercase transition hover:bg-[#20445d] disabled:border-[#2a3944] disabled:bg-[#11181d] disabled:text-[#697b89]"
                    disabled={isBusy || !enrollment}
                    type="submit"
                  >
                    {isBusy ? "Finishing setup…" : "Complete setup"}
                  </button>
                </form>
              </div>
            </div>
          </div>
        </AuthPanel>
      </>,
    );
  }

  if (view === "recovery") {
    return authCardShell(
      <>
        <AuthHero
          eyebrow="Recovery codes"
          primary="These codes replace TOTP only when normal authenticator access is unavailable."
          secondary="They are shown once. Regeneration is a separate authenticated CLI flow."
          tertiary="Store them outside the browser before unlocking the workspace."
        />
        <AuthPanel
          error={error}
          footer={
            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                className="border border-[#2a3b47] bg-[#111920] px-4 py-3 font-label text-[11px] font-semibold tracking-[0.18em] text-[#dbe9f2] uppercase transition hover:border-[#6aa6cc] hover:bg-[#173140]"
                onClick={() => {
                  void handleCopyRecoveryCodes();
                }}
                type="button"
              >
                Copy codes
              </button>
              <button
                className="border border-[#6aa6cc] bg-[#173247] px-4 py-3 font-label text-[11px] font-semibold tracking-[0.18em] text-[#f4f7fa] uppercase transition hover:bg-[#20445d] disabled:border-[#2a3944] disabled:bg-[#11181d] disabled:text-[#697b89]"
                disabled={isBusy}
                onClick={() => {
                  void handleRecoveryContinue();
                }}
                type="button"
              >
                {isBusy ? "Opening workspace…" : "I stored them, continue"}
              </button>
            </div>
          }
          title="View once"
        >
          <div className="space-y-4">
            <div className="text-sm leading-6 text-[#9aabb8]">
              Keep these ten codes somewhere outside the browser. This screen
              will not show them again after you continue.
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              {recoveryCodes.map((code) => (
                <div
                  className="border border-[#22303a] bg-[#10171d] px-4 py-3 font-mono text-sm tracking-[0.14em] text-[#f0f4f7]"
                  key={code}
                >
                  {code}
                </div>
              ))}
            </div>
            {copyFeedback ? (
              <div className="text-xs leading-5 text-[#87b4cf]">
                {copyFeedback}
              </div>
            ) : null}
          </div>
        </AuthPanel>
      </>,
    );
  }

  return authCardShell(
    <>
      <AuthHero
        eyebrow="Sign in"
        primary={`Use your configured ${loginFactorLabel.toLowerCase()} as the first factor.`}
        secondary="Every login also requires the current TOTP code from your authenticator app."
        tertiary="Three failed attempts trigger a ten-minute lockout."
      />
      <AuthPanel
        error={error}
        footer={
          lockedUntilLabel ? (
            <div className="border border-[#4a3522] bg-[#2d1f14] px-4 py-3 text-sm text-[#efc092]">
              Too many failed attempts. Login is locked until {lockedUntilLabel}
              .
            </div>
          ) : null
        }
        title="Unlock workspace"
      >
        <form className="space-y-4" onSubmit={handleLoginSubmit}>
          <AuthInput
            autoComplete={
              status?.primaryFactorType === "pin"
                ? "current-password"
                : "current-password"
            }
            inputMode={status?.primaryFactorType === "pin" ? "numeric" : "text"}
            label={loginFactorLabel}
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
            onChange={(value) => {
              setLoginTotpCode(value.replace(/\D+/g, ""));
            }}
            placeholder="Enter the current 6-digit code"
            type="text"
            value={loginTotpCode}
          />

          <button
            className="w-full border border-[#6aa6cc] bg-[#173247] px-4 py-3 font-label text-[11px] font-semibold tracking-[0.18em] text-[#f4f7fa] uppercase transition hover:bg-[#20445d] disabled:border-[#2a3944] disabled:bg-[#11181d] disabled:text-[#697b89]"
            disabled={isBusy}
            type="submit"
          >
            {isBusy ? "Signing in…" : "Unlock workspace"}
          </button>
        </form>
      </AuthPanel>
    </>,
  );
}
