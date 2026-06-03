/**
 * @file src/mainview/app/thread-start-request-dialog.test.tsx
 * @description Rendering tests for the external thread start request dialog.
 */

import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ThreadStartRequestDialog } from "./thread-start-request-dialog";

const noop = () => {};

describe("ThreadStartRequestDialog", () => {
  it("does not render when closed", () => {
    const markup = renderToStaticMarkup(
      <ThreadStartRequestDialog
        accessEntries={[]}
        busy={false}
        error=""
        open={false}
        projectLabel="Demo Project"
        prompt="Create a demo thread"
        queueLabel="Queued request 1 of 1"
        worktreePath="/tmp/demo"
        onApprove={noop}
        onDismiss={noop}
      />,
    );

    expect(markup).toBe("");
  });

  it("renders review details and accessible dialog semantics", () => {
    const markup = renderToStaticMarkup(
      <ThreadStartRequestDialog
        accessEntries={[
          { label: "Web search", value: "Denied" },
          { label: "Git", value: "Allowed" },
        ]}
        busy={false}
        error="Provider selection is required."
        open={true}
        projectLabel="Demo Project"
        prompt={"Create a demo thread\nUse fake data only."}
        queueLabel="Queued request 1 of 2"
        worktreePath="/tmp/demo-worktree"
        onApprove={noop}
        onDismiss={noop}
      />,
    );

    expect(markup).toContain("<dialog");
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain("aria-labelledby=");
    expect(markup).toContain("aria-describedby=");
    expect(markup).toContain("Create a thread for this workspace?");
    expect(markup).toContain("Review the requested workspace");
    expect(markup).toContain("Demo Project");
    expect(markup).toContain("/tmp/demo-worktree");
    expect(markup).toContain("Create a demo thread");
    expect(markup).toContain("Use fake data only.");
    expect(markup).toContain("Web search: Denied");
    expect(markup).toContain("Git: Allowed");
    expect(markup).toContain("Provider selection is required.");
    expect(markup).toContain("Queued request 1 of 2");
    expect(markup).toContain('aria-label="Dismiss new thread request"');
  });

  it("disables dismiss and approval controls while busy", () => {
    const markup = renderToStaticMarkup(
      <ThreadStartRequestDialog
        accessEntries={[]}
        busy={true}
        error=""
        open={true}
        projectLabel="Demo Project"
        prompt="Create a demo thread"
        queueLabel="Queued request 1 of 1"
        worktreePath="/tmp/demo"
        onApprove={noop}
        onDismiss={noop}
      />,
    );

    expect(markup).toContain("Creating...");
    expect(markup.match(/disabled=""/g)?.length).toBe(3);
  });
});
