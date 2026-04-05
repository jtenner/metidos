export const LARGE_DIFF_WORKER_TEXT_LENGTH = 24_000;

export type DiffLineKind =
  | "meta"
  | "file"
  | "hunk"
  | "context"
  | "add"
  | "remove";

export type DiffLine = {
  kind: DiffLineKind;
  key: string;
  text: string;
};

export type DiffSummary = {
  additions: number;
  deletions: number;
  hunks: number;
};

export type DiffParseResult = {
  lines: DiffLine[];
  summary: DiffSummary;
};

export const EMPTY_DIFF_PARSE_RESULT: DiffParseResult = {
  lines: [],
  summary: {
    additions: 0,
    deletions: 0,
    hunks: 0,
  },
};

export function shouldWorkerizeDiffParsing(diffText: string): boolean {
  return diffText.length >= LARGE_DIFF_WORKER_TEXT_LENGTH;
}

function classifyDiffLine(line: string): DiffLineKind {
  if (line.startsWith("diff --git")) {
    return "meta";
  }
  if (line.startsWith("--- ") || line.startsWith("+++ ")) {
    return "file";
  }
  if (line.startsWith("@@")) {
    return "hunk";
  }
  if (line.startsWith("+")) {
    return "add";
  }
  if (line.startsWith("-")) {
    return "remove";
  }
  return "context";
}

export function parseUnifiedDiffText(diffText: string): DiffParseResult {
  if (!diffText.trim()) {
    return EMPTY_DIFF_PARSE_RESULT;
  }

  const rawLines = diffText.split(/\r?\n/);
  const lines: DiffLine[] = new Array(rawLines.length);
  let additions = 0;
  let deletions = 0;
  let hunks = 0;

  for (let index = 0; index < rawLines.length; index += 1) {
    const line = rawLines[index] ?? "";
    const kind = classifyDiffLine(line);
    if (kind === "hunk") {
      hunks += 1;
    } else if (kind === "add") {
      additions += 1;
    } else if (kind === "remove") {
      deletions += 1;
    }

    lines[index] = {
      kind,
      key: `${index}:${line}`,
      text: line,
    };
  }

  return {
    lines,
    summary: {
      additions,
      deletions,
      hunks,
    },
  };
}
