/**
 * @file src/mainview/app/error-boundary.tsx
 * @description React error boundary and fallback surfaces for client crash recovery.
 */

import { Component, type ErrorInfo, type JSX, type ReactNode } from "react";
import { logClientError } from "../client-logging";
import { AppButton } from "../controls/button";

type ErrorBoundaryFallbackProps = {
  error: unknown;
  reset: () => void;
};

type MainviewErrorBoundaryProps = {
  children?: ReactNode;
  context: string;
  fallback: JSX.Element | ((props: ErrorBoundaryFallbackProps) => JSX.Element);
  message?: string;
};

type MainviewErrorBoundaryState = {
  error: unknown | null;
};

function userFacingErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }
  return "Unknown client error.";
}

export class MainviewErrorBoundary extends Component<
  MainviewErrorBoundaryProps,
  MainviewErrorBoundaryState
> {
  state: MainviewErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): MainviewErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo): void {
    logClientError(
      this.props.message ?? "React error boundary caught a client crash",
      {
        componentStack: errorInfo.componentStack,
        error,
      },
      { context: this.props.context },
    );
  }

  private readonly reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (this.state.error !== null) {
      const fallback = this.props.fallback;
      if (typeof fallback === "function") {
        return fallback({ error: this.state.error, reset: this.reset });
      }
      return fallback;
    }

    return this.props.children;
  }
}

export function MainviewCrashFallback({
  error,
  reset,
}: ErrorBoundaryFallbackProps): JSX.Element {
  const reloadWindow = (): void => {
    window.location.reload();
  };

  return (
    <main className="flex min-h-screen flex-col bg-bg-app text-text-primary">
      <div className="border-b border-border-default bg-bg-canvas px-4 py-3">
        <div className="font-label text-[11px] font-semibold tracking-[0.2em] text-danger-text uppercase">
          Client crash caught
        </div>
        <h1 className="mt-2 text-base font-bold text-text-primary">
          Metidos recovered from a UI crash
        </h1>
      </div>
      <section className="max-w-3xl px-4 py-4 text-sm leading-6 text-text-secondary">
        <p>
          The React tree threw during rendering or lazy loading. The error was
          logged through the client logging pipeline instead of leaving a blank
          screen.
        </p>
        <pre className="mt-3 overflow-auto border border-danger-border bg-danger-surface px-3 py-2 font-mono text-[12px] whitespace-pre-wrap text-danger-text">
          {userFacingErrorMessage(error)}
        </pre>
        <div className="mt-4 flex flex-wrap gap-2">
          <AppButton buttonStyle="primary" onClick={reloadWindow}>
            Reload app
          </AppButton>
          <AppButton buttonStyle="muted" onClick={reset}>
            Try rendering again
          </AppButton>
        </div>
      </section>
    </main>
  );
}
