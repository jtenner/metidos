/**
 * @file src/bun/sql-first-identifier.ts
 * @description Comment-aware SQL token helpers shared by Pi and plugin SQLite guards.
 */

function isSqlIdentifierStart(character: string): boolean {
  return /[A-Za-z_]/u.test(character);
}

function isSqlIdentifierPart(character: string): boolean {
  return /[0-9A-Za-z_$]/u.test(character);
}

export function skipSqlWhitespaceAndComments(
  sql: string,
  startIndex: number,
): number {
  let index = startIndex;

  while (index < sql.length) {
    const character = sql[index] ?? "";
    const nextCharacter = sql[index + 1] ?? "";

    if (/\s/u.test(character)) {
      index += 1;
      continue;
    }

    if (character === "-" && nextCharacter === "-") {
      const newlineIndex = sql.indexOf("\n", index + 2);
      index = newlineIndex === -1 ? sql.length : newlineIndex + 1;
      continue;
    }

    if (character === "/" && nextCharacter === "*") {
      const endIndex = sql.indexOf("*/", index + 2);
      index = endIndex === -1 ? sql.length : endIndex + 2;
      continue;
    }

    break;
  }

  return index;
}

function readSqlIdentifier(
  sql: string,
  startIndex: number,
): { nextIndex: number; value: string } | null {
  const firstCharacter = sql[startIndex] ?? "";
  if (!isSqlIdentifierStart(firstCharacter)) {
    return null;
  }

  let index = startIndex + 1;
  while (index < sql.length && isSqlIdentifierPart(sql[index] ?? "")) {
    index += 1;
  }

  return { nextIndex: index, value: sql.slice(startIndex, index) };
}

export function getFirstSqlIdentifier(
  sql: string,
): { nextIndex: number; value: string } | null {
  return getSqlIdentifierAt(sql, 0);
}

export function getSqlIdentifierAt(
  sql: string,
  startIndex: number,
): { nextIndex: number; value: string } | null {
  const index = skipSqlWhitespaceAndComments(sql, startIndex);
  return readSqlIdentifier(sql, index);
}

function skipSqlQuotedToken(sql: string, startIndex: number): number {
  const quote = sql[startIndex] ?? "";
  const closingQuote = quote === "[" ? "]" : quote;
  let index = startIndex + 1;

  while (index < sql.length) {
    const character = sql[index] ?? "";
    const nextCharacter = sql[index + 1] ?? "";
    if (character === closingQuote) {
      if (
        closingQuote !== "]" &&
        closingQuote !== "`" &&
        nextCharacter === closingQuote
      ) {
        index += 2;
        continue;
      }
      return index + 1;
    }
    index += 1;
  }

  return index;
}

export function findSqlIdentifier(
  sql: string,
  startIndex: number,
  expectedIdentifier: string,
): { nextIndex: number } | null {
  let index = startIndex;

  while (index < sql.length) {
    index = skipSqlWhitespaceAndComments(sql, index);
    const character = sql[index] ?? "";

    if (
      character === "'" ||
      character === '"' ||
      character === "`" ||
      character === "["
    ) {
      index = skipSqlQuotedToken(sql, index);
      continue;
    }

    const identifier = readSqlIdentifier(sql, index);
    if (identifier) {
      if (identifier.value.toLowerCase() === expectedIdentifier) {
        return { nextIndex: identifier.nextIndex };
      }
      index = identifier.nextIndex;
      continue;
    }

    index += 1;
  }

  return null;
}

export function containsSqlFunctionCall(
  sql: string,
  functionName: string,
): boolean {
  let searchIndex = 0;

  while (true) {
    const match = findSqlIdentifier(sql, searchIndex, functionName);
    if (!match) {
      return false;
    }
    const nextIndex = skipSqlWhitespaceAndComments(sql, match.nextIndex);
    if ((sql[nextIndex] ?? "") === "(") {
      return true;
    }
    searchIndex = match.nextIndex;
  }
}
