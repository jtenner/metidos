import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";

type Severity = "error" | "warning";

type Finding = {
  file: string;
  line: number;
  severity: Severity;
  rule: string;
  message: string;
  snippet: string;
};

type Rule = {
  id: string;
  severity: Severity;
  message: string;
  test: (text: string, file: string) => Finding[];
};

const workspaceRoot = process.cwd();
const targetRoots = ["src/mainview"];
const extensions = new Set([".html", ".tsx", ".ts"]);
const ignoredPathParts = new Set([
  "node_modules",
  "dist",
  "build",
  ".git",
  "getdown",
]);

function extensionFor(path: string): string {
  const match = /\.[^.]+$/.exec(path);
  return match?.[0] ?? "";
}

async function collectFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (ignoredPathParts.has(entry.name)) continue;

    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath)));
      continue;
    }

    if (!entry.isFile()) continue;
    if (entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx"))
      continue;
    if (!extensions.has(extensionFor(entry.name))) continue;
    files.push(fullPath);
  }

  return files;
}

function lineNumberAt(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

function lineSnippetAt(text: string, index: number): string {
  const start = text.lastIndexOf("\n", index) + 1;
  const end = text.indexOf("\n", index);
  return text.slice(start, end === -1 ? text.length : end).trim();
}

function finding(
  text: string,
  file: string,
  index: number,
  severity: Severity,
  rule: string,
  message: string,
): Finding {
  return {
    file: relative(workspaceRoot, file),
    line: lineNumberAt(text, index),
    severity,
    rule,
    message,
    snippet: lineSnippetAt(text, index),
  };
}

function attributeValue(tag: string, attribute: string): string | undefined {
  const quoted = new RegExp(`${attribute}\\s*=\\s*(["'])(.*?)\\1`, "i").exec(
    tag,
  );
  if (quoted) return quoted[2];

  const expression = new RegExp(`${attribute}\\s*=\\s*\\{([^}]+)\\}`, "i").exec(
    tag,
  );
  return expression?.[1];
}

function hasAttribute(tag: string, attribute: string): boolean {
  return new RegExp(`(?:^|\\s)${attribute}(?:\\s*=|\\s|>|$)`, "i").test(tag);
}

function stripJsxExpressions(text: string): string {
  return text.replace(/\{[^}]*\}/g, " ");
}

function hasVisibleTextOrKnownLabel(content: string): boolean {
  const withoutExpressions = stripJsxExpressions(content)
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .trim();
  return (
    withoutExpressions.length > 0 ||
    /\{\s*children\s*\}/.test(content) ||
    /<(?:Icon|[A-Z][A-Za-z0-9]*Icon)\b/.test(content)
  );
}

const rules: Rule[] = [
  {
    id: "img-alt",
    severity: "error",
    message:
      'Images must include meaningful alt text or alt="" when decorative.',
    test(text, file) {
      return [...text.matchAll(/<img\b[\s\S]*?>/gi)]
        .filter(
          (match) => !hasAttribute(match[0], "alt") && !/\.test\./.test(file),
        )
        .map((match) =>
          finding(
            text,
            file,
            match.index,
            "error",
            "img-alt",
            rules[0]?.message ?? "Missing alt text",
          ),
        );
    },
  },
  {
    id: "input-name",
    severity: "error",
    message:
      "Inputs need a programmatic name: use a visible label, aria-label, aria-labelledby, or title.",
    test(text, file) {
      return [...text.matchAll(/<input\b[\s\S]*?>/gi)]
        .filter((match) => {
          const tag = match[0];
          const type = attributeValue(tag, "type")?.toLowerCase();
          return (
            type !== "hidden" &&
            type !== "checkbox" &&
            type !== "radio" &&
            !hasAttribute(tag, "aria-label") &&
            !hasAttribute(tag, "aria-labelledby") &&
            !hasAttribute(tag, "title") &&
            !hasAttribute(tag, "id")
          );
        })
        .map((match) =>
          finding(
            text,
            file,
            match.index,
            "error",
            "input-name",
            rules[1]?.message ?? "Input is unnamed",
          ),
        );
    },
  },
  {
    id: "positive-tabindex",
    severity: "error",
    message:
      "Avoid positive tabIndex values; preserve DOM order and use tabIndex={0} or {-1} only when needed.",
    test(text, file) {
      return [
        ...text.matchAll(
          /tabIndex\s*=\s*(?:["']([1-9]\d*)["']|\{([1-9]\d*)\})/g,
        ),
      ].map((match) =>
        finding(
          text,
          file,
          match.index,
          "error",
          "positive-tabindex",
          rules[2]?.message ?? "Positive tabIndex",
        ),
      );
    },
  },
  {
    id: "autofocus",
    severity: "error",
    message:
      "Avoid autoFocus because it can disorient keyboard and screen-reader users.",
    test(text, file) {
      return [...text.matchAll(/\bautoFocus\b/g)].map((match) =>
        finding(
          text,
          file,
          match.index,
          "error",
          "autofocus",
          rules[3]?.message ?? "Avoid autoFocus",
        ),
      );
    },
  },
  {
    id: "aria-hidden-focusable",
    severity: "error",
    message: "Do not put aria-hidden on focusable or interactive elements.",
    test(text, file) {
      return [
        ...text.matchAll(
          /<(button|a|input|select|textarea)\b[^>]*aria-hidden\s*=\s*(?:["']true["']|\{true\})[^>]*>/gi,
        ),
      ].map((match) =>
        finding(
          text,
          file,
          match.index,
          "error",
          "aria-hidden-focusable",
          rules[4]?.message ?? "Interactive element is aria-hidden",
        ),
      );
    },
  },
  {
    id: "click-keyboard",
    severity: "warning",
    message:
      "Clickable non-interactive elements need keyboard support or should be native buttons/links.",
    test(text, file) {
      return [
        ...text.matchAll(
          /<(div|span|li|section|article)\b(?=[^>]*onClick=)([^>]*)>/gi,
        ),
      ]
        .filter(
          (match) =>
            !/onKey(?:Down|Up|Press)=/.test(match[0]) ||
            !/role=/.test(match[0]) ||
            !/tabIndex=/.test(match[0]),
        )
        .map((match) =>
          finding(
            text,
            file,
            match.index,
            "warning",
            "click-keyboard",
            rules[5]?.message ?? "Click without keyboard",
          ),
        );
    },
  },
  {
    id: "empty-button",
    severity: "warning",
    message:
      "Buttons need an accessible name from visible text, aria-label, aria-labelledby, or title.",
    test(text, file) {
      return [...text.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)]
        .filter((match) => {
          const attrs = match[1] ?? "";
          const content = match[2] ?? "";
          return (
            !/\.\.\./.test(attrs) &&
            !hasAttribute(attrs, "aria-label") &&
            !hasAttribute(attrs, "aria-labelledby") &&
            !hasAttribute(attrs, "title") &&
            !hasVisibleTextOrKnownLabel(content)
          );
        })
        .map((match) =>
          finding(
            text,
            file,
            match.index,
            "warning",
            "empty-button",
            rules[6]?.message ?? "Button is unnamed",
          ),
        );
    },
  },
  {
    id: "outline-none",
    severity: "warning",
    message:
      "Removing outlines requires an equally visible focus indicator via focus-visible/focus styles.",
    test(text, file) {
      return [...text.matchAll(/outline-none/g)]
        .filter(
          (match) =>
            !/focus(?:-visible)?:/.test(lineSnippetAt(text, match.index)),
        )
        .map((match) =>
          finding(
            text,
            file,
            match.index,
            "warning",
            "outline-none",
            rules[7]?.message ?? "Outline removed",
          ),
        );
    },
  },
];

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function formatFinding(result: Finding): string {
  const prefix = result.severity === "error" ? "error" : "warning";
  return `${prefix} ${result.rule} ${result.file}:${result.line}\n  ${result.message}\n  ${result.snippet}`;
}

async function main() {
  const strict = process.argv.includes("--strict");
  const files: string[] = [];

  for (const targetRoot of targetRoots) {
    const fullRoot = join(workspaceRoot, targetRoot);
    if (await pathExists(fullRoot)) {
      files.push(...(await collectFiles(fullRoot)));
    }
  }

  const findings: Finding[] = [];
  for (const file of files) {
    const text = await readFile(file, "utf8");
    for (const rule of rules) findings.push(...rule.test(text, file));
  }

  const errors = findings.filter((result) => result.severity === "error");
  const warnings = findings.filter((result) => result.severity === "warning");
  const failing = strict ? findings : errors;

  if (findings.length > 0) {
    console.log(findings.map(formatFinding).join("\n\n"));
    console.log("");
  }

  console.log(
    `A11y check scanned ${files.length} files: ${errors.length} errors, ${warnings.length} warnings${strict ? " (strict)" : ""}.`,
  );

  if (failing.length > 0) process.exit(1);
}

await main();
