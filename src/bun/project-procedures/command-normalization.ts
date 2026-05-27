/**
 * @file src/bun/project-procedures/command-normalization.ts
 * @description Shared normalization for command display text.
 */

const POSIX_SHELL_NAMES = new Set(["bash", "sh", "zsh"]);
const WINDOWS_CMD_NAMES = new Set(["cmd", "cmd.exe"]);
const WINDOWS_POWERSHELL_NAMES = new Set([
  "powershell",
  "powershell.exe",
  "pwsh",
  "pwsh.exe",
]);

const POSIX_WRAPPER_PATTERN =
  /^(?<launcher>\S+)(?<options>(?:\s+\S+)*?)\s+(?<flag>-lc|-cl|-c)(?:\s+--)?\s+(?<body>[\s\S]+)$/;
const CMD_WRAPPER_PATTERN =
  /^(?<launcher>\S+)(?<options>(?:\s+\S+)*?)\s+(?<flag>\/c)\s+(?<body>[\s\S]+)$/i;
const POWERSHELL_WRAPPER_PATTERN =
  /^(?<launcher>\S+)(?<options>(?:\s+\S+)*?)\s+(?<flag>-(?:command|c))\s+(?<body>[\s\S]+)$/i;

type CommandWrapperKind = "cmd" | "posix" | "powershell";

type ParsedCommandWrapper = {
  body: string;
  kind: CommandWrapperKind;
};

/**
 * Removes shell wrapper noise from command execution text.
 * @param command - Raw command text coming from sidecar/runtime events.
 */
export function normalizeCommandDisplayText(command: string): string {
  const trimmed = command.trim();
  const parsedWrapper = parseCommandWrapper(trimmed);
  if (!parsedWrapper) {
    return command;
  }

  return decodeWrappedCommand(parsedWrapper) ?? command;
}

/**
 * Parse supported shell wrappers and return the wrapped command body.
 */
function parseCommandWrapper(command: string): ParsedCommandWrapper | null {
  const posixMatch = command.match(POSIX_WRAPPER_PATTERN);
  if (posixMatch) {
    const launcher = posixMatch.groups?.launcher;
    const options = splitWrapperOptions(posixMatch.groups?.options);
    const body = posixMatch.groups?.body;
    if (
      typeof launcher === "string" &&
      typeof body === "string" &&
      isPosixShellLauncher(launcher, options)
    ) {
      return {
        body,
        kind: "posix",
      };
    }
  }

  const cmdMatch = command.match(CMD_WRAPPER_PATTERN);
  if (cmdMatch) {
    const launcher = cmdMatch.groups?.launcher;
    const body = cmdMatch.groups?.body;
    if (
      typeof launcher === "string" &&
      typeof body === "string" &&
      isLauncherBasename(launcher, WINDOWS_CMD_NAMES)
    ) {
      return {
        body,
        kind: "cmd",
      };
    }
  }

  const powerShellMatch = command.match(POWERSHELL_WRAPPER_PATTERN);
  if (powerShellMatch) {
    const launcher = powerShellMatch.groups?.launcher;
    const body = powerShellMatch.groups?.body;
    if (
      typeof launcher === "string" &&
      typeof body === "string" &&
      isLauncherBasename(launcher, WINDOWS_POWERSHELL_NAMES)
    ) {
      return {
        body,
        kind: "powershell",
      };
    }
  }

  return null;
}

/**
 * Decode wrapper-specific quoting so the UI shows the original command text.
 */
function decodeWrappedCommand(wrapper: ParsedCommandWrapper): string | null {
  if (wrapper.kind === "posix") {
    const decodedShellWordText = decodePosixQuotedShellWordText(wrapper.body);
    if (typeof decodedShellWordText === "string") {
      return decodedShellWordText;
    }
  }

  const quotedBody = unwrapOuterQuotes(wrapper.body);
  if (!quotedBody) {
    const trimmedBody = wrapper.body.trim();
    if (trimmedBody.startsWith('"') || trimmedBody.startsWith("'")) {
      return null;
    }
    return wrapper.body;
  }

  switch (wrapper.kind) {
    case "posix":
      return quotedBody.quote === '"'
        ? decodePosixDoubleQuotedText(quotedBody.text)
        : quotedBody.text;
    case "cmd":
      return decodeCmdText(quotedBody.text);
    case "powershell":
      return quotedBody.quote === '"'
        ? decodePowerShellDoubleQuotedText(quotedBody.text)
        : quotedBody.text.replace(/''/g, "'");
  }
}

/**
 * Decode a POSIX shell word that may splice together single-quoted and double-quoted segments.
 */
function decodePosixQuotedShellWordText(text: string): string | null {
  const trimmed = text.trim();
  if (!(trimmed.startsWith("'") || trimmed.startsWith('"'))) {
    return null;
  }

  let result = "";
  let mode: "double" | "single" | "unquoted" = "unquoted";

  for (let index = 0; index < trimmed.length; index += 1) {
    const character = trimmed[index] ?? "";
    const nextCharacter = trimmed[index + 1] ?? "";

    if (mode === "single") {
      if (character === "'") {
        mode = "unquoted";
        continue;
      }
      result += character;
      continue;
    }

    if (mode === "double") {
      if (character === '"') {
        mode = "unquoted";
        continue;
      }
      if (character === "\\" && nextCharacter) {
        if (nextCharacter === "\n") {
          index += 1;
          continue;
        }
        const decoded = POSIX_DOUBLE_QUOTED_ESCAPES[nextCharacter];
        if (typeof decoded === "string") {
          result += decoded;
          index += 1;
          continue;
        }
      }
      result += character;
      continue;
    }

    if (/\s/.test(character)) {
      return null;
    }

    if (character === "'") {
      mode = "single";
      continue;
    }

    if (character === '"') {
      mode = "double";
      continue;
    }

    if (character === "\\") {
      if (!nextCharacter) {
        return null;
      }
      if (nextCharacter !== "\n") {
        result += nextCharacter;
      }
      index += 1;
      continue;
    }

    result += character;
  }

  return mode === "unquoted" ? result : null;
}

const POSIX_DOUBLE_QUOTED_ESCAPES: Record<string, string> = {
  // POSIX double quotes preserve backslash only before $, `, ", \\, and
  // newline; these mappings decode the wrapped shell word for display without
  // attempting to re-execute it.
  '"': '"',
  "\\": "\\",
  $: "$",
  "`": "`",
  n: "\n",
  r: "\r",
  t: "\t",
};

/**
 * Split wrapper options text into whitespace-delimited tokens.
 */
function splitWrapperOptions(optionsText: string | undefined): string[] {
  if (typeof optionsText !== "string") {
    return [];
  }

  const trimmed = optionsText.trim();
  return trimmed ? trimmed.split(/\s+/) : [];
}

/**
 * Detect whether the launcher token represents a supported POSIX shell wrapper.
 */
function isPosixShellLauncher(launcher: string, options: string[]): boolean {
  if (isLauncherBasename(launcher, POSIX_SHELL_NAMES)) {
    return true;
  }

  if (!isLauncherBasename(launcher, new Set(["env"]))) {
    return false;
  }

  const shellName = options[0];
  return (
    typeof shellName === "string" &&
    isLauncherBasename(shellName, POSIX_SHELL_NAMES)
  );
}

/**
 * Compare a launcher token by basename across POSIX and Windows path separators.
 */
function isLauncherBasename(
  launcher: string,
  acceptedNames: Set<string>,
): boolean {
  const normalized = launcher.split(/[\\/]/).at(-1)?.toLowerCase();
  return typeof normalized === "string" && acceptedNames.has(normalized);
}

/**
 * Extract an optionally quoted body so the shell-specific decoder can unwrap it.
 */
function unwrapOuterQuotes(text: string): {
  quote: '"' | "'";
  text: string;
} | null {
  const trimmed = text.trim();
  if (trimmed.length < 2) {
    return null;
  }

  const quote = trimmed[0];
  const lastCharacter = trimmed.at(-1);
  if (
    (quote !== '"' && quote !== "'") ||
    typeof lastCharacter !== "string" ||
    lastCharacter !== quote
  ) {
    return null;
  }

  return {
    quote,
    text: trimmed.slice(1, -1),
  };
}

/**
 * Best-effort decoding for POSIX double-quoted command payloads.
 */
function decodePosixDoubleQuotedText(text: string): string {
  return decodeEscapeSequences(text, {
    '"': '"',
    "\\": "\\",
    $: "$",
    "`": "`",
    n: "\n",
    r: "\r",
    t: "\t",
  });
}

/**
 * Decode cmd.exe escaping used inside the wrapped command string.
 */
function decodeCmdText(text: string): string {
  let result = "";
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"' && text[index + 1] === '"') {
      result += '"';
      index += 1;
      continue;
    }
    if (
      character === "^" &&
      typeof text[index + 1] === "string" &&
      `^&|<>()%!"`.includes(text[index + 1] ?? "")
    ) {
      result += text[index + 1];
      index += 1;
      continue;
    }
    result += character;
  }
  return result;
}

/**
 * Best-effort decoding for PowerShell expandable string escapes.
 */
function decodePowerShellDoubleQuotedText(text: string): string {
  let result = "";
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const nextCharacter = text[index + 1] ?? "";
    if (character === '"' && text[index + 1] === '"') {
      result += '"';
      index += 1;
      continue;
    }
    if (character === "`" && nextCharacter) {
      const decoded = POWERSHELL_ESCAPES[nextCharacter];
      if (typeof decoded === "string") {
        result += decoded;
        index += 1;
        continue;
      }
    }
    result += character;
  }
  return result;
}

const POWERSHELL_ESCAPES: Record<string, string> = {
  0: "\0",
  a: "\u0007",
  b: "\b",
  e: "\u001b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
  v: "\v",
  '"': '"',
  "'": "'",
  "`": "`",
  $: "$",
};

/**
 * Shared escape decoder used for shell wrappers that backslash-escape characters.
 */
function decodeEscapeSequences(
  text: string,
  escapeMap: Record<string, string>,
): string {
  let result = "";
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const nextCharacter = text[index + 1] ?? "";
    if (character === "\\" && nextCharacter) {
      const decoded = escapeMap[nextCharacter];
      if (typeof decoded === "string") {
        result += decoded;
        index += 1;
        continue;
      }
    }
    result += character;
  }
  return result;
}
