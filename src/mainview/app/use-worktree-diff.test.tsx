/**
 * @file src/mainview/app/use-worktree-diff.test.tsx
 * @description Focused state-transition tests for worktree diff file patch payloads.
 */

import { describe, expect, it } from "bun:test";
import type { RpcWorktreeFileDiff } from "../../bun/rpc-schema";
import { emptyDiffFilePatchState } from "./diff-workspace";
import {
  nextDiffFilePatchErrorState,
  nextDiffFilePatchRequestState,
  nextDiffFilePatchSuccessState,
} from "./use-worktree-diff";

function diffResult(path: string, diffText: string): RpcWorktreeFileDiff {
  return {
    diffText,
    path,
    projectId: 7,
    worktreePath: "/tmp/metidos-demo",
  };
}

describe("use-worktree-diff file patch state transitions", () => {
  it("moves fake large and binary diff payloads from loading to loaded state", () => {
    const loadingLarge = nextDiffFilePatchRequestState(
      emptyDiffFilePatchState(),
      "docs/large-generated-fixture.txt",
    );

    expect(loadingLarge).toEqual({
      diffText: "",
      error: "",
      isLoading: true,
      path: "docs/large-generated-fixture.txt",
    });

    const largeDiff = [
      "diff --git a/docs/large-generated-fixture.txt b/docs/large-generated-fixture.txt",
      "--- a/docs/large-generated-fixture.txt",
      "+++ b/docs/large-generated-fixture.txt",
      ...Array.from({ length: 80 }, (_, index) => `+fake large line ${index}`),
    ].join("\n");
    const loadedLarge = nextDiffFilePatchSuccessState(
      diffResult("docs/large-generated-fixture.txt", largeDiff),
    );

    expect(loadedLarge).toEqual({
      diffText: largeDiff,
      error: "",
      isLoading: false,
      path: "docs/large-generated-fixture.txt",
    });
    expect(loadedLarge.diffText).toContain("+fake large line 79");

    const binaryDiff =
      "diff --git a/fixtures/logo.png b/fixtures/logo.png\n" +
      "Binary files a/fixtures/logo.png and b/fixtures/logo.png differ\n";
    const loadedBinary = nextDiffFilePatchSuccessState(
      diffResult("fixtures/logo.png", binaryDiff),
    );

    expect(loadedBinary.diffText).toContain("Binary files");
    expect(loadedBinary.error).toBe("");
    expect(loadedBinary.isLoading).toBe(false);
    expect(loadedBinary.path).toBe("fixtures/logo.png");
  });

  it("preserves visible patches during background refreshes and replaces them for foreground requests", () => {
    const current = nextDiffFilePatchSuccessState(
      diffResult("src/demo.ts", "+visible fake patch\n"),
    );

    expect(
      nextDiffFilePatchRequestState(current, "src/demo.ts", {
        background: true,
      }),
    ).toBe(current);

    expect(nextDiffFilePatchRequestState(current, "src/demo.ts")).toEqual({
      diffText: "",
      error: "",
      isLoading: true,
      path: "src/demo.ts",
    });

    expect(
      nextDiffFilePatchRequestState(current, "src/other.ts", {
        background: true,
      }),
    ).toEqual({
      diffText: "",
      error: "",
      isLoading: true,
      path: "src/other.ts",
    });
  });

  it("loads deleted and renamed fake diff payloads and keeps failed states path-scoped", () => {
    const deletedDiff =
      "diff --git a/src/old.ts b/src/old.ts\n" +
      "deleted file mode 100644\n" +
      "--- a/src/old.ts\n" +
      "+++ /dev/null\n" +
      "@@ -1 +0,0 @@\n" +
      "-export const removed = true;\n";
    const deletedState = nextDiffFilePatchSuccessState(
      diffResult("src/old.ts", deletedDiff),
    );

    expect(deletedState.path).toBe("src/old.ts");
    expect(deletedState.diffText).toContain("deleted file mode 100644");
    expect(deletedState.isLoading).toBe(false);

    const renamedDiff =
      "diff --git a/src/old-name.ts b/src/new-name.ts\n" +
      "similarity index 100%\n" +
      "rename from src/old-name.ts\n" +
      "rename to src/new-name.ts\n";
    const renamedState = nextDiffFilePatchSuccessState(
      diffResult("src/new-name.ts", renamedDiff),
    );

    expect(renamedState.path).toBe("src/new-name.ts");
    expect(renamedState.diffText).toContain("rename from src/old-name.ts");
    expect(renamedState.diffText).toContain("rename to src/new-name.ts");

    const failedSamePath = nextDiffFilePatchErrorState(
      renamedState,
      "src/new-name.ts",
      new Error("Unable to read renamed diff."),
    );
    expect(failedSamePath.diffText).toBe(renamedDiff);
    expect(failedSamePath.error).toBe("Unable to read renamed diff.");
    expect(failedSamePath.isLoading).toBe(false);
    expect(failedSamePath.path).toBe("src/new-name.ts");

    const failedNewPath = nextDiffFilePatchErrorState(
      renamedState,
      "src/missing.ts",
      "Diff fixture missing.",
    );
    expect(failedNewPath).toEqual({
      diffText: "",
      error: "Diff fixture missing.",
      isLoading: false,
      path: "src/missing.ts",
    });
  });
});
