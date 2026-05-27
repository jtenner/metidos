import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

type Finding = {
  line: number;
  path: string;
  rule: string;
  snippet: string;
};

const failOnViolations = process.argv.includes("--fail-on-violations");
const root = join(process.cwd(), "src", "mainview");
const hexColorPattern = /#[0-9A-Fa-f]{3,8}/g;
const nativeButtonPattern = /<button\b/g;

function isTestPath(path: string): boolean {
  return /\.test\.[cm]?[jt]sx?$/.test(path);
}

function normalizePath(path: string): string {
  return path.split(sep).join("/");
}

function isScannablePath(path: string): boolean {
  return /\.(css|html|js|jsx|md|mjs|ts|tsx)$/.test(path);
}

function shouldScanHex(path: string): boolean {
  const normalized = normalizePath(path);

  return (
    !isTestPath(normalized) &&
    !normalized.endsWith("src/mainview/input.css") &&
    !normalized.endsWith("src/mainview/index.css")
  );
}

function shouldScanButtons(path: string): boolean {
  const normalized = normalizePath(path);

  return (
    !isTestPath(normalized) &&
    !normalized.endsWith("src/mainview/controls/button.tsx") &&
    !normalized.endsWith("src/mainview/controls/list-row.tsx")
  );
}

async function collectFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);

      if (entry.isDirectory()) {
        return collectFiles(path);
      }

      if (entry.isFile() && isScannablePath(path)) {
        return [path];
      }

      return [];
    }),
  );

  return files.flat();
}

function collectMatches(path: string, contents: string): Finding[] {
  const findings: Finding[] = [];
  const relativePath = normalizePath(relative(process.cwd(), path));

  for (const [index, line] of contents.split("\n").entries()) {
    if (shouldScanHex(path) && hexColorPattern.test(line)) {
      findings.push({
        line: index + 1,
        path: relativePath,
        rule: "no raw hex colors outside token files/tests",
        snippet: line.trim(),
      });
    }

    hexColorPattern.lastIndex = 0;

    if (shouldScanButtons(path) && nativeButtonPattern.test(line)) {
      findings.push({
        line: index + 1,
        path: relativePath,
        rule: "prefer AppButton over native <button>",
        snippet: line.trim(),
      });
    }

    nativeButtonPattern.lastIndex = 0;
  }

  return findings;
}

const findings = (
  await Promise.all(
    (
      await collectFiles(root)
    ).map(async (path) => collectMatches(path, await readFile(path, "utf8"))),
  )
).flat();

if (findings.length === 0) {
  console.log("STYLE.md enforcement: no violations found.");
  process.exit(0);
}

console.warn(
  `STYLE.md enforcement: found ${findings.length} warning${findings.length === 1 ? "" : "s"}.`,
);
console.warn(
  "These checks currently warn to allow incremental migration. Run with --fail-on-violations to enforce.",
);

for (const finding of findings) {
  console.warn(
    `${finding.path}:${finding.line}: ${finding.rule}: ${finding.snippet}`,
  );
}

if (failOnViolations) {
  process.exit(1);
}
