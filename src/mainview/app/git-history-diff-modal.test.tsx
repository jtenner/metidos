/**
 * @file src/mainview/app/git-history-diff-modal.test.tsx
 * @description Focused tests for git history commit diff modal states.
 */

import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { GitHistoryModalState } from "./git-history-state";
import { GitHistoryDiffModal } from "./git-history-diff-modal";

function makeModalState(
  overrides?: Partial<GitHistoryModalState>,
): GitHistoryModalState {
  return {
    diffText:
      "diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-old line\n+new line\n",
    entry: {
      authorName: "Alice Example",
      committedAt: "2026-05-05T14:30:00.000Z",
      hash: "abcdef1234567890",
      shortHash: "abcdef1",
      subject: "Improve demo docs",
    },
    error: "",
    loading: false,
    projectId: 7,
    worktreePath: "/tmp/metidos-demo",
    ...overrides,
  };
}

function renderModal(state: GitHistoryModalState): string {
  return renderToStaticMarkup(
    <GitHistoryDiffModal state={state} onClose={() => undefined} />,
  );
}

describe("GitHistoryDiffModal presentation states", () => {
  it("renders commit metadata and accessible close affordances", () => {
    const markup = renderModal(makeModalState());

    expect(markup).toContain("Commit Diff");
    expect(markup).toContain("Improve demo docs");
    expect(markup).toContain("abcdef1");
    expect(markup).toContain("Alice Example");
    expect(markup.match(/aria-label="Close commit diff"/g) ?? []).toHaveLength(
      2,
    );
    expect(markup).toContain('aria-modal="true"');
  });

  it("renders loading and error states without rendering stale diff text", () => {
    const loadingMarkup = renderModal(
      makeModalState({ diffText: "+stale", loading: true }),
    );
    expect(loadingMarkup).toContain("Loading diff...");
    expect(loadingMarkup).not.toContain("+stale");

    const errorMarkup = renderModal(
      makeModalState({ error: "Unable to load commit diff." }),
    );
    expect(errorMarkup).toContain("Unable to load commit diff.");
    expect(errorMarkup).not.toContain("new line");
  });

  it("renders fake small, deleted, renamed, and empty diff payloads", () => {
    const smallMarkup = renderModal(makeModalState());
    expect(smallMarkup).toContain("diff --git a/README.md b/README.md");
    expect(smallMarkup).toContain("old line");
    expect(smallMarkup).toContain("new line");

    const deletedMarkup = renderModal(
      makeModalState({
        diffText:
          "diff --git a/old.txt b/old.txt\ndeleted file mode 100644\n--- a/old.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-removed\n",
      }),
    );
    expect(deletedMarkup).toContain("deleted file mode 100644");
    expect(deletedMarkup).toContain("removed");

    const renamedMarkup = renderModal(
      makeModalState({
        diffText:
          "diff --git a/old-name.txt b/new-name.txt\nsimilarity index 100%\nrename from old-name.txt\nrename to new-name.txt\n",
      }),
    );
    expect(renamedMarkup).toContain("rename from old-name.txt");
    expect(renamedMarkup).toContain("rename to new-name.txt");

    expect(renderModal(makeModalState({ diffText: "" }))).toContain(
      "No diff available.",
    );
  });
});
