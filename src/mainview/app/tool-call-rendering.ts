/**
 * @file src/mainview/app/tool-call-rendering.ts
 * @description Helpers for Pi tool-call transcript rendering.
 */

export type ToolCallMessageState =
  | "in_progress"
  | "completed"
  | "failed"
  | "stopped";

export type ToolCallPresentation = {
  outputLabel: string;
  preview: string | null;
};

export type ToolCallDisplayOptions = {
  homeDirectory: string;
  supportsTildePath: boolean;
};

/**
 * Parse stored tool arguments when they are valid JSON.
 * @param argumentsText - Persisted arguments text from transcript activity.
 */
export function parseToolCallArguments(argumentsText: string): unknown | null {
  const trimmed = argumentsText.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

/**
 * Build the compact header preview and output label for one tool call row.
 * @param tool - Tool name.
 * @param argumentsText - Persisted arguments text from transcript activity.
 * @param state - Current tool-call state.
 * @param displayOptions - Optional home-directory display options.
 */
export function describeToolCall(
  tool: string,
  argumentsText: string,
  state: ToolCallMessageState,
  displayOptions?: ToolCallDisplayOptions,
): ToolCallPresentation {
  const displayArgumentsText = displayOptions
    ? formatToolCallTextForDisplay(argumentsText, displayOptions)
    : argumentsText;

  return {
    outputLabel: state === "failed" ? "Error" : toolOutputLabel(tool),
    preview:
      describeToolCallPreview(
        tool,
        parseToolCallArguments(displayArgumentsText),
      ) ?? fallbackToolArgumentPreview(displayArgumentsText),
  };
}

function describeToolCallPreview(
  tool: string,
  parsedArguments: unknown,
): string | null {
  switch (tool) {
    case "read":
      return describeReadPreview(parsedArguments);
    case "ls":
      return describeLsPreview(parsedArguments);
    case "find":
      return describeFindPreview(parsedArguments);
    case "grep":
      return describeGrepPreview(parsedArguments);
    case "bash":
      return describeBashPreview(parsedArguments);
    case "edit":
      return describeEditPreview(parsedArguments);
    case "write":
      return describeWritePreview(parsedArguments);
    case "sqlite":
      return describeSqlitePreview(parsedArguments);
    case "lancedb_upsert":
      return describeLanceDbUpsertPreview(parsedArguments);
    case "lancedb_query":
      return describeLanceDbQueryPreview(parsedArguments);
    case "lancedb_delete":
      return describeLanceDbDeletePreview(parsedArguments);
    default:
      return describeGenericPreview(parsedArguments);
  }
}

function toolOutputLabel(tool: string): string {
  switch (tool) {
    case "read":
      return "Contents";
    case "ls":
      return "Listing";
    case "find":
    case "grep":
      return "Matches";
    case "bash":
      return "Command";
    case "edit":
    case "write":
    case "sqlite":
    case "lancedb_upsert":
    case "lancedb_query":
    case "lancedb_delete":
      return "Result";
    default:
      return "Output";
  }
}

function describeReadPreview(parsedArguments: unknown): string | null {
  if (!isRecord(parsedArguments)) {
    return null;
  }

  const path = readStringProperty(parsedArguments, "path");
  const qualifiers = [
    formatNamedNumberProperty(parsedArguments, "offset"),
    formatNamedNumberProperty(parsedArguments, "limit"),
  ].filter((value): value is string => value !== null);

  return joinPrimaryPreview(path, qualifiers);
}

function describeLsPreview(parsedArguments: unknown): string | null {
  if (!isRecord(parsedArguments)) {
    return null;
  }

  const path = readStringProperty(parsedArguments, "path") ?? ".";
  const qualifiers = [
    formatLimitQualifier(readNumberProperty(parsedArguments, "limit")),
  ].filter((value): value is string => value !== null);

  return joinPrimaryPreview(path, qualifiers);
}

function describeFindPreview(parsedArguments: unknown): string | null {
  if (!isRecord(parsedArguments)) {
    return null;
  }

  const pattern = readStringProperty(parsedArguments, "pattern");
  const path = readStringProperty(parsedArguments, "path");
  const base =
    pattern && path
      ? `${pattern} in ${path}`
      : (pattern ?? path ?? readStringProperty(parsedArguments, "glob"));
  const qualifiers = [
    formatLimitQualifier(readNumberProperty(parsedArguments, "limit")),
  ].filter((value): value is string => value !== null);

  return joinPrimaryPreview(base, qualifiers);
}

function describeGrepPreview(parsedArguments: unknown): string | null {
  if (!isRecord(parsedArguments)) {
    return null;
  }

  const pattern = readStringProperty(parsedArguments, "pattern");
  const path = readStringProperty(parsedArguments, "path");
  const base =
    pattern && path
      ? `${pattern} in ${path}`
      : (pattern ?? path ?? readStringProperty(parsedArguments, "glob"));
  const qualifiers = [
    readStringProperty(parsedArguments, "glob"),
    formatBooleanQualifier(
      "ignore case",
      readBooleanProperty(parsedArguments, "caseInsensitive"),
    ),
    formatLimitQualifier(readNumberProperty(parsedArguments, "limit")),
  ].filter((value): value is string => value !== null);

  return joinPrimaryPreview(base, qualifiers);
}

function describeBashPreview(parsedArguments: unknown): string | null {
  if (!isRecord(parsedArguments)) {
    return null;
  }

  const command = readStringProperty(parsedArguments, "command");
  const qualifiers = [
    formatNamedNumberProperty(parsedArguments, "timeout"),
  ].filter((value): value is string => value !== null);

  return joinPrimaryPreview(command, qualifiers);
}

function describeEditPreview(parsedArguments: unknown): string | null {
  if (!isRecord(parsedArguments)) {
    return null;
  }

  const path = readStringProperty(parsedArguments, "path");
  const editCount = resolveEditCount(parsedArguments);
  const qualifiers =
    editCount === null
      ? []
      : [`${editCount} edit block${editCount === 1 ? "" : "s"}`];

  return joinPrimaryPreview(path, qualifiers);
}

function describeWritePreview(parsedArguments: unknown): string | null {
  if (!isRecord(parsedArguments)) {
    return null;
  }

  const path = readStringProperty(parsedArguments, "path");
  const lineCount = countLines(
    readStringPropertyAllowEmpty(parsedArguments, "content"),
  );
  const qualifiers =
    lineCount === null || lineCount === 0
      ? []
      : [`${lineCount} line${lineCount === 1 ? "" : "s"}`];

  return joinPrimaryPreview(path, qualifiers);
}

function describeSqlitePreview(parsedArguments: unknown): string | null {
  if (!isRecord(parsedArguments)) {
    return null;
  }

  const path = readStringProperty(parsedArguments, "path");
  const query = readStringProperty(parsedArguments, "query");
  const queryType = query ? readLeadingSqlKeyword(query) : null;
  const qualifiers = queryType ? [queryType] : [];

  return joinPrimaryPreview(path, qualifiers);
}

function describeLanceDbUpsertPreview(parsedArguments: unknown): string | null {
  if (!isRecord(parsedArguments)) {
    return null;
  }

  const path = readStringProperty(parsedArguments, "path");
  const props = isRecord(parsedArguments.props) ? parsedArguments.props : null;
  const id = props ? readStringOrNumberProperty(props, "id") : null;
  return joinPrimaryPreview(
    path,
    id === null ? ["upsert"] : [`upsert id ${id}`],
  );
}

function describeLanceDbQueryPreview(parsedArguments: unknown): string | null {
  if (!isRecord(parsedArguments)) {
    return null;
  }

  const path = readStringProperty(parsedArguments, "path");
  const query = readStringProperty(parsedArguments, "query");
  return joinPrimaryPreview(path, query ? [`query ${query}`] : ["query"]);
}

function describeLanceDbDeletePreview(parsedArguments: unknown): string | null {
  if (!isRecord(parsedArguments)) {
    return null;
  }

  const path = readStringProperty(parsedArguments, "path");
  const id = readStringOrNumberProperty(parsedArguments, "id");
  return joinPrimaryPreview(
    path,
    id === null ? ["delete"] : [`delete id ${id}`],
  );
}

function describeGenericPreview(parsedArguments: unknown): string | null {
  if (!isRecord(parsedArguments)) {
    return null;
  }

  return (
    readStringProperty(parsedArguments, "path") ??
    readStringProperty(parsedArguments, "command") ??
    readStringProperty(parsedArguments, "pattern") ??
    readStringProperty(parsedArguments, "query")
  );
}

function fallbackToolArgumentPreview(argumentsText: string): string | null {
  const trimmed = argumentsText.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return null;
  }

  return trimmed.replaceAll(/\s+/g, " ");
}

function joinPrimaryPreview(
  primary: string | null,
  qualifiers: string[],
): string | null {
  if (primary === null) {
    return qualifiers.length > 0 ? qualifiers.join(", ") : null;
  }

  if (qualifiers.length === 0) {
    return primary;
  }

  return `${primary} (${qualifiers.join(", ")})`;
}

/**
 * Formats tool-call text with the home directory rendered as `~`.
 * @param value - Raw tool-call text to display.
 * @param options - Home-directory display options.
 */
export function formatToolCallTextForDisplay(
  value: string,
  options: ToolCallDisplayOptions,
): string {
  if (!options.supportsTildePath || !options.homeDirectory) {
    return value;
  }

  const normalizedHomeDirectory = options.homeDirectory.replace(/[\\/]+$/u, "");
  if (!normalizedHomeDirectory) {
    return value;
  }

  const candidateHomeDirectories = normalizedHomeDirectory.includes("\\")
    ? [normalizedHomeDirectory, normalizedHomeDirectory.replace(/\\/gu, "/")]
    : [normalizedHomeDirectory];

  let formattedValue = value;
  for (const candidateHomeDirectory of candidateHomeDirectories) {
    formattedValue = replaceHomeDirectoryPrefixInText(
      formattedValue,
      candidateHomeDirectory,
    );
    if (candidateHomeDirectory.includes("\\")) {
      formattedValue = replaceHomeDirectoryPrefixInText(
        formattedValue,
        candidateHomeDirectory.replace(/\\/g, "\\\\"),
      );
    }
  }

  return formattedValue;
}

function replaceHomeDirectoryPrefixInText(
  value: string,
  homeDirectory: string,
): string {
  let cursor = 0;
  let rewritten = "";
  let matchIndex = value.indexOf(homeDirectory);

  while (matchIndex !== -1) {
    const matchEnd = matchIndex + homeDirectory.length;
    if (isHomeDirectoryBoundary(value, matchEnd)) {
      rewritten += `${value.slice(cursor, matchIndex)}~`;
      cursor = matchEnd;
    }
    matchIndex = value.indexOf(homeDirectory, matchEnd);
  }

  if (cursor === 0) {
    return value;
  }

  return `${rewritten}${value.slice(cursor)}`;
}

function isHomeDirectoryBoundary(value: string, index: number): boolean {
  if (index >= value.length) {
    return true;
  }

  const nextCharacter = value.charAt(index);
  return (
    nextCharacter === "/" ||
    nextCharacter === "\\" ||
    /\s/u.test(nextCharacter) ||
    nextCharacter === '"' ||
    nextCharacter === "'" ||
    nextCharacter === "`" ||
    nextCharacter === "," ||
    nextCharacter === ";" ||
    nextCharacter === ":" ||
    nextCharacter === "!" ||
    nextCharacter === "?" ||
    nextCharacter === ")" ||
    nextCharacter === "]" ||
    nextCharacter === "}" ||
    nextCharacter === ">"
  );
}

function resolveEditCount(
  parsedArguments: Record<string, unknown>,
): number | null {
  const edits = parsedArguments.edits;
  if (Array.isArray(edits)) {
    return edits.length;
  }

  return typeof parsedArguments.oldText === "string" ||
    typeof parsedArguments.newText === "string"
    ? 1
    : null;
}

function formatNamedNumberProperty(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = readNumberProperty(record, key);
  return value === null ? null : `${key} ${value}`;
}

function formatLimitQualifier(limit: number | null): string | null {
  return limit === null ? null : `limit ${limit}`;
}

function formatBooleanQualifier(
  label: string,
  value: boolean | null,
): string | null {
  return value === true ? label : null;
}

function countLines(value: string | null): number | null {
  if (value === null) {
    return null;
  }

  if (value.length === 0) {
    return 0;
  }

  return value.split(/\r?\n/u).length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readStringOrNumberProperty(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key];
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function readStringProperty(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key];
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readStringPropertyAllowEmpty(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function readNumberProperty(
  record: Record<string, unknown>,
  key: string,
): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readBooleanProperty(
  record: Record<string, unknown>,
  key: string,
): boolean | null {
  const value = record[key];
  return typeof value === "boolean" ? value : null;
}

function readLeadingSqlKeyword(value: string): string | null {
  const match = value.trim().match(/^([a-z_]+)/iu);
  return match?.[1] ? match[1].toUpperCase() : null;
}
