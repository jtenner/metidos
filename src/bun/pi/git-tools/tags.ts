/**
 * @file src/bun/pi/git-tools/tags.ts
 * @description Shared helpers for Pi-native Git tag tools.
 */

import { runGitCommand } from "../../git";

const GIT_TAG_FIELD_SEPARATOR = "\u001f";
const GIT_TAG_FORMAT = [
  "%(refname:short)",
  "%(objectname:short)",
  "%(objecttype)",
  "%(taggerdate:iso-strict)",
  "%(creatordate:iso-strict)",
  "%(contents:subject)",
].join(GIT_TAG_FIELD_SEPARATOR);
const GIT_TAG_REF_PREFIX = "refs/tags/";

export type GitTagEntry = {
  annotated: boolean;
  date: string | null;
  name: string;
  objectHash: string;
  objectType: string;
  subject: string | null;
  targetHash: string;
};

type ParsedGitTagEntry = {
  date: string | null;
  name: string;
  objectHash: string;
  objectType: string;
  subject: string | null;
};

function splitTextLines(value: string): string[] {
  if (!value) {
    return [];
  }

  return value.replace(/\r\n/g, "\n").split("\n");
}

function parseGitTagListing(raw: string): ParsedGitTagEntry[] {
  if (!raw.trim()) {
    return [];
  }

  const entries: ParsedGitTagEntry[] = [];
  for (const line of splitTextLines(raw)) {
    if (!line.trim()) {
      continue;
    }

    const [
      name = "",
      objectHash = "",
      objectType = "",
      taggerDate = "",
      creatorDate = "",
      subject = "",
    ] = line.split(GIT_TAG_FIELD_SEPARATOR);
    if (!name) {
      continue;
    }

    entries.push({
      date: taggerDate || creatorDate || null,
      name,
      objectHash: objectHash || "unknown",
      objectType: objectType || "unknown",
      subject: subject || null,
    });
  }

  return entries;
}

async function resolveGitTagTargetHash(
  worktreePath: string,
  tagName: string,
  signal?: AbortSignal,
): Promise<string> {
  return runGitCommand(
    worktreePath,
    ["rev-parse", "--verify", `${GIT_TAG_REF_PREFIX}${tagName}^{}`],
    typeof signal === "undefined" ? undefined : { signal },
  );
}

async function decorateGitTagEntries(
  worktreePath: string,
  entries: ParsedGitTagEntry[],
  signal?: AbortSignal,
): Promise<GitTagEntry[]> {
  return Promise.all(
    entries.map(async (entry) => ({
      annotated: entry.objectType === "tag",
      date: entry.date,
      name: entry.name,
      objectHash: entry.objectHash,
      objectType: entry.objectType,
      subject: entry.subject,
      targetHash: await resolveGitTagTargetHash(
        worktreePath,
        entry.name,
        signal,
      ),
    })),
  );
}

export function normalizeGitTagName(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.startsWith(GIT_TAG_REF_PREFIX)
    ? trimmed.slice(GIT_TAG_REF_PREFIX.length)
    : trimmed;
}

function buildGitTagFormatCommand(maxTags: number): string[] {
  return [
    "for-each-ref",
    "--sort=refname",
    `--count=${maxTags}`,
    "--format",
    GIT_TAG_FORMAT,
    "refs/tags",
  ];
}

export async function readGitTagListing(
  worktreePath: string,
  maxTags: number,
  signal?: AbortSignal,
): Promise<GitTagEntry[]> {
  const raw = await runGitCommand(
    worktreePath,
    buildGitTagFormatCommand(maxTags),
    typeof signal === "undefined" ? undefined : { signal },
  );
  return decorateGitTagEntries(worktreePath, parseGitTagListing(raw), signal);
}

export async function readGitTagEntry(
  worktreePath: string,
  tagName: string,
  signal?: AbortSignal,
): Promise<GitTagEntry | null> {
  const raw = await runGitCommand(
    worktreePath,
    [
      "for-each-ref",
      "--format",
      GIT_TAG_FORMAT,
      `${GIT_TAG_REF_PREFIX}${tagName}`,
    ],
    typeof signal === "undefined" ? undefined : { signal },
  );
  const entries = parseGitTagListing(raw);
  if (entries.length === 0) {
    return null;
  }

  const [entry] = await decorateGitTagEntries(worktreePath, entries, signal);
  return entry ?? null;
}

export function formatGitTagEntry(entry: GitTagEntry): string {
  const kindText = entry.annotated ? "annotated" : "lightweight";
  const targetText =
    entry.targetHash !== entry.objectHash ? ` -> ${entry.targetHash}` : "";
  const dateText = entry.date ? ` @ ${entry.date}` : "";
  const subjectText = entry.subject ? ` — ${entry.subject}` : "";
  return `${entry.name} ${kindText} ${entry.objectHash}${targetText}${dateText}${subjectText}`;
}
