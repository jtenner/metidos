/**
 * @file src/mainview/app/terminal-workspace.test.tsx
 * @description Render-level tests for terminal workspace empty states and affordances.
 */

import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { RpcTerminal, RpcTerminalStatus } from "../../bun/rpc-schema";
import {
  terminalCloseConfirmationDetails,
  terminalStatusView,
  TerminalRendererStateOverlay,
  TerminalWorkspace,
} from "./terminal-workspace";

function fakeTerminal(overrides: Partial<RpcTerminal> = {}): RpcTerminal {
  return {
    command: null,
    cols: 80,
    createdAt: "2026-06-03T00:00:00.000Z",
    createdFromThreadId: null,
    cwd: "/repo/demo",
    exitCode: null,
    exitSignal: null,
    projectId: 7,
    projectName: "Demo Project",
    rows: 24,
    status: "running",
    terminalId: "terminal-1",
    terminalIndex: 1,
    title: "Demo shell",
    updatedAt: "2026-06-03T00:01:00.000Z",
    worktreeFolder: "feature/demo",
    worktreePath: "/repo/demo",
    ...overrides,
  };
}

function renderTerminalWorkspace(
  overrides: Partial<Parameters<typeof TerminalWorkspace>[0]> = {},
): string {
  return renderToStaticMarkup(
    <TerminalWorkspace
      activeTerminalId={null}
      canCreateTerminal={false}
      onCloseTerminal={() => undefined}
      onCreateTerminal={() => undefined}
      onRenameTerminal={() => undefined}
      onSelectTerminal={() => undefined}
      terminals={[]}
      {...overrides}
    />,
  );
}

describe("TerminalWorkspace render states", () => {
  it("renders no-worktree empty-state copy and disables the create affordance", () => {
    const markup = renderTerminalWorkspace();

    expect(markup).toContain("Select a worktree to create a terminal.");
    expect(markup).toContain("Open terminals");
    expect(markup).toContain("New Terminal");
    expect(markup).toContain('disabled=""');
  });

  it("renders an enabled empty-state create action when a worktree is selected", () => {
    const markup = renderTerminalWorkspace({ canCreateTerminal: true });

    expect(markup).toContain("New Terminal");
    expect(markup).not.toContain("Select a worktree to create a terminal.");
    expect(markup).not.toContain('disabled=""');
  });

  it("renders terminal row labels from fake terminal payloads", () => {
    const markup = renderTerminalWorkspace({
      activeTerminalId: "terminal-2",
      canCreateTerminal: true,
      terminals: [
        fakeTerminal({
          cwd: "/repo/demo",
          terminalId: "terminal-1",
          title: "Demo shell",
        }),
        fakeTerminal({
          cwd: "/repo/demo/packages/app",
          terminalId: "terminal-2",
          title: "App tests",
        }),
      ],
    });

    expect(markup).toContain("Demo shell");
    expect(markup).toContain("/repo/demo");
    expect(markup).toContain("Rename Demo shell");
    expect(markup).toContain("Close Demo shell");
    expect(markup).toContain("App tests");
    expect(markup).toContain("/repo/demo/packages/app");
    expect(markup).toContain("Rename App tests");
    expect(markup).toContain("Close App tests");
  });

  it("summarizes terminal lifecycle states without exposing terminal output", () => {
    const statuses: RpcTerminalStatus[] = [
      "starting",
      "running",
      "closing",
      "exited",
      "error",
    ];
    const markup = renderTerminalWorkspace({
      terminals: statuses.map((status, index) =>
        fakeTerminal({
          command: index === 4 ? "echo secret-output" : null,
          cwd: `/repo/demo/${status}`,
          status,
          terminalId: `terminal-${status}`,
          title: `Demo ${status}`,
        }),
      ),
    });

    for (const expected of [
      "Connecting",
      "Connected",
      "Disconnecting",
      "Disconnected",
      "Failed",
    ]) {
      expect(markup).toContain(expected);
    }
    expect(markup).not.toContain("secret-output");
  });

  it("maps terminal statuses to accessible labels and semantic tones", () => {
    expect(terminalStatusView("starting")).toEqual({
      label: "Starting",
      summary: "Connecting",
      tone: "info",
    });
    expect(terminalStatusView("running")).toEqual({
      label: "Running",
      summary: "Connected",
      tone: "success",
    });
    expect(terminalStatusView("closing")).toEqual({
      label: "Closing",
      summary: "Disconnecting",
      tone: "warning",
    });
    expect(terminalStatusView("exited")).toEqual({
      label: "Exited",
      summary: "Disconnected",
      tone: "neutral",
    });
    expect(terminalStatusView("error")).toEqual({
      label: "Error",
      summary: "Failed",
      tone: "danger",
    });
  });

  it("renders terminal renderer loading state through a static test seam", () => {
    const markup = renderToStaticMarkup(
      <TerminalRendererStateOverlay errorMessage={null} loading={true} />,
    );

    expect(markup).toContain("Loading terminal renderer.");
    expect(markup).toContain("sr-only");
  });

  it("renders terminal renderer failure guidance without loading ghostty-web", () => {
    const markup = renderToStaticMarkup(
      <TerminalRendererStateOverlay
        errorMessage="fixture wasm load failure"
        loading={false}
      />,
    );

    expect(markup).toContain(
      "Terminal renderer failed to load. Refresh the window and try again.",
    );
    expect(markup).toContain("fixture wasm load failure");
  });

  it("formats close-confirmation copy for a pending running terminal", () => {
    expect(
      terminalCloseConfirmationDetails(
        fakeTerminal({
          projectName: "Demo Project",
          title: "Long running task",
          worktreeFolder: "feature/terminal-tests",
        }),
      ),
    ).toBe("Long running task - Demo Project · feature/terminal-tests");
  });
});
