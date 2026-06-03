/**
 * @file src/mainview/app/terminal-workspace.tsx
 * @description Desktop terminal interaction panel powered by ghostty-web.
 */

import type { JSX } from "react";
import { AppButton } from "../controls/button";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RpcTerminal } from "../../bun/rpc-schema";
import {
  dispatchAuthRequired,
  isAuthRequiredError,
  issueWebSocketTicket,
} from "../auth-client";
import { logClientError } from "../client-logging";
import { ConfirmDialog } from "../controls/confirm-dialog";
import { materialSymbol } from "../controls/icons";
import { ListRow, ListRowIconButton } from "../controls/list-row";
import { PopoverSurface } from "../controls/popover";

export type TerminalWorkspaceProps = {
  activeTerminalId: string | null;
  canCreateTerminal: boolean;
  onCloseTerminal: (terminal: RpcTerminal) => void;
  onCreateTerminal: () => void;
  onRenameTerminal: (terminalId: string, title: string) => void;
  onSelectTerminal: (terminalId: string) => void;
  terminals: RpcTerminal[];
};

type GhosttyModule = typeof import("ghostty-web");
type LoadedGhostty = {
  ghostty: Awaited<ReturnType<GhosttyModule["Ghostty"]["load"]>>;
  module: GhosttyModule;
};

type TerminalRowProps = {
  active: boolean;
  onClose: (terminal: RpcTerminal) => void;
  onRename: (terminalId: string, title: string) => void;
  onSelect: (terminalId: string) => void;
  terminal: RpcTerminal;
};

const CLIENT_TERMINAL_SCROLLBACK_LINES = 2_000;

let ghosttyInitPromise: Promise<LoadedGhostty> | null = null;

function loadGhostty(): Promise<LoadedGhostty> {
  if (!ghosttyInitPromise) {
    ghosttyInitPromise = import("ghostty-web")
      .then(async (module) => ({
        ghostty: await module.Ghostty.load("/ghostty-vt.wasm"),
        module,
      }))
      .catch((error: unknown) => {
        ghosttyInitPromise = null;
        throw error;
      });
  }
  return ghosttyInitPromise;
}

function terminalWebSocketUrl(terminalId: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/terminal/${encodeURIComponent(terminalId)}`;
}

function readCssVariable(name: string, fallback = ""): string {
  if (typeof window === "undefined") {
    return fallback;
  }
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
}

const GhosttyTerminal = memo(function GhosttyTerminal({
  active,
  terminal,
}: {
  active: boolean;
  terminal: RpcTerminal;
}): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fitRef = useRef<{ fit: () => void; observeResize?: () => void } | null>(
    null,
  );
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let socket: WebSocket | null = null;
    let term: InstanceType<GhosttyModule["Terminal"]> | null = null;
    const disposables: Array<{ dispose?: () => void }> = [];

    setLoadError(null);
    void loadGhostty()
      .then(({ ghostty, module }) => {
        if (disposed || !containerRef.current) {
          return;
        }
        const nextTerm = new module.Terminal({
          ghostty,
          cursorBlink: true,
          fontFamily: readCssVariable("--font-mono", "monospace"),
          fontSize: 13,
          scrollback: CLIENT_TERMINAL_SCROLLBACK_LINES,
          theme: {
            background: readCssVariable("--color-bg-app"),
            cursor: readCssVariable("--color-accent-strong"),
            foreground: readCssVariable("--color-text-primary"),
            selectionBackground: readCssVariable("--color-accent-surface"),
          },
        });
        const fitAddon = new module.FitAddon();
        fitRef.current = fitAddon;
        nextTerm.loadAddon(fitAddon);
        nextTerm.open(containerRef.current);
        term = nextTerm;
        fitAddon.fit();
        fitAddon.observeResize?.();

        void (async () => {
          try {
            await issueWebSocketTicket();
            if (disposed) {
              return;
            }
            socket = new WebSocket(terminalWebSocketUrl(terminal.terminalId));
            socket.onmessage = (event) => {
              try {
                const message = JSON.parse(String(event.data)) as {
                  type: string;
                  data?: string;
                };
                if (message.type === "output" || message.type === "replay") {
                  nextTerm.write(message.data ?? "");
                }
              } catch {
                // Terminal messages are JSON envelopes; ignore malformed frames.
              }
            };
          } catch (error) {
            if (isAuthRequiredError(error)) {
              dispatchAuthRequired("terminal websocket authentication failed");
              return;
            }
            logClientError("Failed to open terminal websocket", error, {
              context: `terminalId:${terminal.terminalId}`,
            });
          }
        })();
        disposables.push(
          nextTerm.onData((data) => {
            if (socket?.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({ type: "input", data }));
            }
          }),
        );
        if (nextTerm.onResize) {
          disposables.push(
            nextTerm.onResize((size) => {
              if (socket?.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({ type: "resize", ...size }));
              }
            }),
          );
        }
      })
      .catch((error: unknown) => {
        if (disposed) {
          return;
        }
        logClientError("Failed to load terminal renderer", error, {
          context: `terminalId:${terminal.terminalId}`,
        });
        setLoadError(
          error instanceof Error && error.message
            ? error.message
            : "Terminal renderer failed to load.",
        );
      });

    return () => {
      disposed = true;
      for (const disposable of disposables) {
        disposable.dispose?.();
      }
      socket?.close();
      term?.dispose?.();
      fitRef.current = null;
    };
  }, [terminal.terminalId]);

  useEffect(() => {
    if (!active) {
      return;
    }
    const id = window.requestAnimationFrame(() => {
      fitRef.current?.fit();
    });
    return () => {
      window.cancelAnimationFrame(id);
    };
  }, [active]);

  return (
    <div
      aria-hidden={!active}
      className={`absolute inset-0 bg-bg-app ${active ? "visible" : "invisible pointer-events-none"}`}
    >
      <div
        className="h-full w-full overflow-hidden p-2 caret-transparent [&_textarea]:caret-transparent"
        ref={containerRef}
      />
      {loadError ? (
        <div className="absolute inset-0 flex items-center justify-center bg-bg-app px-4 text-center text-sm text-danger-text">
          Terminal renderer failed to load. Refresh the window and try again.
          <span className="sr-only"> {loadError}</span>
        </div>
      ) : null}
    </div>
  );
});

function TerminalRow({
  active,
  onClose,
  onRename,
  onSelect,
  terminal,
}: TerminalRowProps): JSX.Element {
  const editButtonRef = useRef<HTMLButtonElement | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(terminal.title);

  useEffect(() => {
    if (!editing) {
      setDraft(terminal.title);
    }
  }, [editing, terminal.title]);

  const submitRename = (): void => {
    const next = draft.trim();
    if (next) {
      onRename(terminal.terminalId, next);
    }
    setEditing(false);
  };

  return (
    <ListRow active={active}>
      <div className="flex items-center gap-3">
        <AppButton
          unstyled
          className="min-w-0 flex-1 text-left"
          onAuxClick={(event) => {
            if (event.button === 1) {
              event.preventDefault();
              onClose(terminal);
            }
          }}
          onClick={() => {
            onSelect(terminal.terminalId);
          }}
          type="button"
        >
          <div className="truncate text-[14px] font-medium leading-4">
            <span>{terminal.title}</span>
            <span className="text-text-faint"> - </span>
            <span className="font-mono text-[11px] text-text-muted">
              {terminal.cwd}
            </span>
          </div>
        </AppButton>
        <div className="flex shrink-0 items-center gap-1 pl-2">
          <ListRowIconButton
            aria-label={`Rename ${terminal.title}`}
            onClick={() => {
              setEditing(true);
            }}
            ref={editButtonRef}
          >
            {materialSymbol("description", "text-[15px]")}
          </ListRowIconButton>
          <ListRowIconButton
            aria-label={`Close ${terminal.title}`}
            onClick={() => {
              onClose(terminal);
            }}
            tone="danger"
          >
            {materialSymbol("close", "text-[15px]")}
          </ListRowIconButton>
        </div>
      </div>
      <PopoverSurface
        className="z-[120] w-64 border border-border-default bg-surface-overlay p-3 text-xs text-text-secondary shadow-overlay"
        offsetPx={8}
        closeOnOutsidePress={true}
        onRequestClose={() => {
          setEditing(false);
        }}
        open={editing}
        placement="left"
        reference={editButtonRef.current}
        role="dialog"
      >
        <label className="block">
          <span className="font-label text-[10px] uppercase tracking-[0.1em] text-text-faint">
            Title
          </span>
          <input
            aria-label="Terminal title"
            className="mt-1.5 h-8 w-full border border-border-default bg-surface-1 px-2 text-xs text-text-primary outline-none focus:border-accent focus:ring-2 focus:ring-accent/25"
            name="terminal-session-title"
            onChange={(event) => {
              setDraft(event.currentTarget.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submitRename();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setEditing(false);
              }
            }}
            value={draft}
          />
        </label>
        <div className="mt-3 flex justify-end gap-2">
          <AppButton
            buttonStyle="muted"
            onClick={() => {
              setEditing(false);
            }}
          >
            Cancel
          </AppButton>
          <AppButton buttonStyle="secondary" onClick={submitRename}>
            Ok
          </AppButton>
        </div>
      </PopoverSurface>
    </ListRow>
  );
}

export function terminalCloseConfirmationDetails(
  terminal: RpcTerminal,
): string {
  return `${terminal.title} - ${terminal.projectName} · ${terminal.worktreeFolder}`;
}

export function TerminalCloseConfirmation({
  onCancel,
  onConfirm,
  pendingClose,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  pendingClose: RpcTerminal | null;
}): JSX.Element {
  return (
    <ConfirmDialog
      {...(pendingClose
        ? {
            details: terminalCloseConfirmationDetails(pendingClose),
          }
        : {})}
      message="Are you sure you want to exit this terminal?"
      onCancel={onCancel}
      onConfirm={onConfirm}
      open={pendingClose !== null}
    />
  );
}

export function TerminalWorkspace({
  activeTerminalId,
  canCreateTerminal,
  onCloseTerminal,
  onCreateTerminal,
  onRenameTerminal,
  onSelectTerminal,
  terminals,
}: TerminalWorkspaceProps): JSX.Element {
  const [pendingClose, setPendingClose] = useState<RpcTerminal | null>(null);
  const activeTerminal = useMemo(
    () =>
      terminals.find((terminal) => terminal.terminalId === activeTerminalId) ??
      terminals[0] ??
      null,
    [activeTerminalId, terminals],
  );
  const closeTerminal = useCallback(
    (terminal: RpcTerminal): void => {
      if (terminal.status === "running" || terminal.status === "starting") {
        setPendingClose(terminal);
        return;
      }
      onCloseTerminal(terminal);
    },
    [onCloseTerminal],
  );

  return (
    <div className="flex h-full min-h-0 border-t border-composer-border bg-bg-app">
      <div className="relative min-w-0 flex-1 bg-bg-app">
        {activeTerminal ? (
          <GhosttyTerminal
            active
            key={activeTerminal.terminalId}
            terminal={activeTerminal}
          />
        ) : null}
        {terminals.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-text-muted">
            {canCreateTerminal ? (
              <AppButton buttonStyle="secondary" onClick={onCreateTerminal}>
                New Terminal
              </AppButton>
            ) : (
              "Select a worktree to create a terminal."
            )}
          </div>
        ) : null}
      </div>
      <aside className="w-72 shrink-0 border-l border-border-subtle bg-surface-1">
        <div className="flex h-8 items-center justify-between border-b border-border-subtle px-3">
          <div className="font-label text-[10px] uppercase tracking-[0.1em] text-text-muted">
            Open terminals
          </div>
          <AppButton
            buttonStyle="muted"
            disabled={!canCreateTerminal}
            onClick={onCreateTerminal}
          >
            New Terminal
          </AppButton>
        </div>
        <div className="py-1">
          {terminals.map((terminal) => (
            <TerminalRow
              active={terminal.terminalId === activeTerminal?.terminalId}
              key={terminal.terminalId}
              onClose={closeTerminal}
              onRename={onRenameTerminal}
              onSelect={onSelectTerminal}
              terminal={terminal}
            />
          ))}
        </div>
      </aside>
      <TerminalCloseConfirmation
        onCancel={() => {
          setPendingClose(null);
        }}
        onConfirm={() => {
          if (pendingClose) {
            onCloseTerminal(pendingClose);
          }
          setPendingClose(null);
        }}
        pendingClose={pendingClose}
      />
    </div>
  );
}
