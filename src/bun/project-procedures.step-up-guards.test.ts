import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repositoryRoot = process.cwd();

function linesAround(
  lines: string[],
  lineIndex: number,
  lookbehind: number,
): string {
  return lines
    .slice(Math.max(0, lineIndex - lookbehind), lineIndex + 1)
    .join("\n");
}

describe("recent step-up procedure guards", () => {
  it("keeps direct plugin step-up checks paired with manage_app", () => {
    const source = readFileSync(
      join(repositoryRoot, "src/bun/project-procedures/plugin-procedures.ts"),
      "utf8",
    );
    const lines = source.split("\n");
    const guardedLines = lines
      .map((line, index) => ({ index, line }))
      .filter(({ line }) =>
        line.includes(
          'requireLocalOperatorCapability(context, "recent_step_up")',
        ),
      );

    expect(guardedLines.length).toBeGreaterThan(0);
    for (const { index } of guardedLines) {
      expect(linesAround(lines, index, 5)).toContain(
        'requireLocalOperatorCapability(context, "manage_app")',
      );
    }
  });

  it("keeps project procedure step-up helpers paired with requireManageApp", () => {
    const source = readFileSync(
      join(repositoryRoot, "src/bun/project-procedures.ts"),
      "utf8",
    );
    const lines = source.split("\n");
    const stepUpCallLines = lines
      .map((line, index) => ({ index, line }))
      .filter(({ line }) => line.trim() === "requireRecentStepUp(context);");

    expect(stepUpCallLines.length).toBeGreaterThan(0);
    for (const { index } of stepUpCallLines) {
      expect(linesAround(lines, index, 5)).toContain(
        "requireManageApp(context);",
      );
    }
  });
});
