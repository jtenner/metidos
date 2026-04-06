/**
 * @file src/bun/project-procedures/command-normalization.ts
 * @description Shared normalization for command display text.
 */

/**
 * Removes shell wrapper noise from command execution text.
 * @param command - Raw command text coming from sidecar/runtime events.
 */
export function normalizeCommandDisplayText(command: string): string {
  const trimmed = command.trim();
  const match = trimmed.match(/^\/bin\/bash\s+-lc\s+(["'])([\s\S]*)\1$/);
  if (!match) {
    return command;
  }

  const quote = match[1];
  const wrappedCommand = match[2];
  if (typeof quote !== "string" || typeof wrappedCommand !== "string") {
    return command;
  }

  if (quote === '"') {
    try {
      return JSON.parse(`"${wrappedCommand}"`);
    } catch {
      return wrappedCommand
        .replace(/\\n/g, "\n")
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\");
    }
  }

  return wrappedCommand;
}
