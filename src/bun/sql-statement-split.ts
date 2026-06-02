/**
 * @file src/bun/sql-statement-split.ts
 * @description Shared SQL statement splitter for single-statement guards.
 */

export function splitTopLevelSqlStatements(query: string): string[] {
  const statements: string[] = [];
  const currentParts: string[] = [];
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inBacktickQuote = false;
  let inBracketIdentifier = false;
  let inLineComment = false;
  let inBlockComment = false;

  const append = (value: string): void => {
    currentParts.push(value);
  };
  const flushCurrentStatement = (): void => {
    const trimmed = currentParts.join("").trim();
    if (trimmed) {
      statements.push(trimmed);
    }
    currentParts.length = 0;
  };

  for (let index = 0; index < query.length; index += 1) {
    const character = query[index] ?? "";
    const nextCharacter = query[index + 1] ?? "";

    if (inLineComment) {
      append(character);
      if (character === "\n") {
        inLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      append(character);
      if (character === "*" && nextCharacter === "/") {
        append(nextCharacter);
        index += 1;
        inBlockComment = false;
      }
      continue;
    }

    if (inSingleQuote) {
      append(character);
      if (character === "'" && nextCharacter === "'") {
        append(nextCharacter);
        index += 1;
        continue;
      }
      if (character === "'") {
        inSingleQuote = false;
      }
      continue;
    }

    if (inDoubleQuote) {
      append(character);
      if (character === '"' && nextCharacter === '"') {
        append(nextCharacter);
        index += 1;
        continue;
      }
      if (character === '"') {
        inDoubleQuote = false;
      }
      continue;
    }

    if (inBacktickQuote) {
      append(character);
      if (character === "`") {
        inBacktickQuote = false;
      }
      continue;
    }

    if (inBracketIdentifier) {
      append(character);
      if (character === "]") {
        inBracketIdentifier = false;
      }
      continue;
    }

    if (character === "-" && nextCharacter === "-") {
      append(character);
      append(nextCharacter);
      index += 1;
      inLineComment = true;
      continue;
    }

    if (character === "/" && nextCharacter === "*") {
      append(character);
      append(nextCharacter);
      index += 1;
      inBlockComment = true;
      continue;
    }

    if (character === "'") {
      append(character);
      inSingleQuote = true;
      continue;
    }

    if (character === '"') {
      append(character);
      inDoubleQuote = true;
      continue;
    }

    if (character === "`") {
      append(character);
      inBacktickQuote = true;
      continue;
    }

    if (character === "[") {
      append(character);
      inBracketIdentifier = true;
      continue;
    }

    if (character === ";") {
      const currentStatement = currentParts.join("");
      const lowerCurrentStatement = currentStatement.toLowerCase();
      if (
        /\bcreate\s+(?:temp(?:orary)?\s+)?trigger\b/.test(
          lowerCurrentStatement,
        ) &&
        !/\bend\s*$/.test(lowerCurrentStatement)
      ) {
        // SQLite trigger bodies contain semicolon-separated inner statements,
        // but the whole CREATE TRIGGER ... BEGIN ... END block is still one
        // top-level statement for plugin single-statement enforcement.
        append(character);
        continue;
      }
      flushCurrentStatement();
      continue;
    }

    append(character);
  }

  flushCurrentStatement();

  return statements;
}
