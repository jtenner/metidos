/**
 * @file src/mainview/app/terminal-workspace.test.tsx
 * @description Render-level tests for terminal workspace empty states and affordances.
 */

import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { TerminalWorkspace } from "./terminal-workspace";

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
});
