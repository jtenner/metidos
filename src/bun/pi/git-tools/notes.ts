/**
 * @file src/bun/pi/git-tools/notes.ts
 * @description Shared helpers for Pi-native Git notes tools.
 */

import { runGitCommand } from "../../git";

const GIT_NOTES_FIELD_SEPARATOR = "\u001f";
const GIT_NOTES_REF_PREFIX = "refs/notes/";
const GIT_NOTES_SHOW_NO_NOTE_MESSAGE = "no note found for object";
const GIT_NOTES_REF_FORMAT = [
  "%(refname:short)",
  "%(objectname:short)",
  "%(objecttype)",
  "%(contents:subject)",
].join(GIT_NOTES_FIELD_SEPARATOR);

export type GitNoteRefEntry = {
  name: string;
  objectHash: string;
  objectType: string;
  subject: string | null;
};

type ParsedGitNoteRefEntry = {
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

function parseGitNoteRefListing(raw: string): ParsedGitNoteRefEntry[] {
  if (!raw.trim()) {
    return [];
  }

  const entries: ParsedGitNoteRefEntry[] = [];
  for (const line of splitTextLines(raw)) {
    if (!line.trim()) {
      continue;
    }

    const [name = "", objectHash = "", objectType = "", subject = ""] =
      line.split(GIT_NOTES_FIELD_SEPARATOR);
    if (!name) {
      continue;
    }

    entries.push({
      name,
      objectHash: objectHash || "unknown",
      objectType: objectType || "unknown",
      subject: subject || null,
    });
  }

  return entries;
}

function normalizeBareGitNotesRefName(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith(GIT_NOTES_REF_PREFIX)) {
    const stripped = trimmed.slice(GIT_NOTES_REF_PREFIX.length).trim();
    return stripped.length > 0 ? stripped : null;
  }

  if (trimmed.startsWith("notes/")) {
    const stripped = trimmed.slice("notes/".length).trim();
    return stripped.length > 0 ? stripped : null;
  }

  if (trimmed.startsWith("refs/")) {
    throw new Error("Notes refs must stay under refs/notes/.");
  }

  return trimmed;
}

export function normalizeGitNotesRefName(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  return normalizeBareGitNotesRefName(value);
}

export function buildGitNotesRefPath(refName: string): string {
  return `${GIT_NOTES_REF_PREFIX}${refName}`;
}

export function formatGitNoteRefEntry(entry: GitNoteRefEntry): string {
  const subjectText = entry.subject ? ` — ${entry.subject}` : "";
  return `${entry.name} ${entry.objectType} ${entry.objectHash}${subjectText}`;
}

function isMissingGitNoteError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.message.toLowerCase().includes(GIT_NOTES_SHOW_NO_NOTE_MESSAGE);
}

export async function readGitNoteText(
  worktreePath: string,
  targetHash: string,
  refName: string,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    return await runGitCommand(
      worktreePath,
      ["notes", "--ref", refName, "show", targetHash],
      typeof signal === "undefined" ? undefined : { signal },
    );
  } catch (error) {
    if (isMissingGitNoteError(error)) {
      return null;
    }
    throw error;
  }
}

export async function readGitNoteRefListing(
  worktreePath: string,
  maxRefs: number,
  signal?: AbortSignal,
): Promise<GitNoteRefEntry[]> {
  const raw = await runGitCommand(
    worktreePath,
    [
      "for-each-ref",
      "--sort=refname",
      `--count=${maxRefs}`,
      "--format",
      GIT_NOTES_REF_FORMAT,
      "refs/notes",
    ],
    typeof signal === "undefined" ? undefined : { signal },
  );
  return parseGitNoteRefListing(raw);
}
