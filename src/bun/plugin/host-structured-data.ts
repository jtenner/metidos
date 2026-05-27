/**
 * @file src/bun/plugin/host-structured-data.ts
 * @description Language-neutral structured-data host operations for Plugin runtime adapters.
 */

import {
  convertHtmlToMarkdown,
  convertMarkdownToHtml,
} from "../html-to-markdown";
import { encodeXmlText, parseXmlDocument } from "./xml";

type BunStructuredDataFormatApi = {
  parse(content: string): unknown;
  stringify?: (value: unknown) => string;
};

type BunStructuredDataApis = typeof Bun & {
  TOML: BunStructuredDataFormatApi;
  YAML: BunStructuredDataFormatApi;
};

const bunStructuredDataApis = Bun as BunStructuredDataApis;

function isTomlRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertTomlKey(key: string): string {
  if (/^[A-Za-z0-9_-]+$/.test(key)) {
    return key;
  }
  return JSON.stringify(key);
}

function stringifyTomlValue(value: unknown): string {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stringifyTomlValue(item)).join(", ")}]`;
  }
  throw new TypeError(`Cannot stringify ${typeof value} value as TOML.`);
}

export function stringifyTomlDocument(value: unknown): string {
  if (!isTomlRecord(value)) {
    throw new TypeError("TOML.stringify requires a top-level object.");
  }
  const lines: string[] = [];
  const tables: Array<[string[], Record<string, unknown>]> = [];
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined || entry === null) {
      continue;
    }
    if (isTomlRecord(entry)) {
      tables.push([[key], entry]);
      continue;
    }
    lines.push(`${assertTomlKey(key)} = ${stringifyTomlValue(entry)}`);
  }
  for (const [path, table] of tables) {
    if (lines.length > 0) {
      lines.push("");
    }
    lines.push(`[${path.map(assertTomlKey).join(".")}]`);
    for (const [key, entry] of Object.entries(table)) {
      if (entry === undefined || entry === null) {
        continue;
      }
      if (isTomlRecord(entry)) {
        tables.push([[...path, key], entry]);
        continue;
      }
      lines.push(`${assertTomlKey(key)} = ${stringifyTomlValue(entry)}`);
    }
  }
  return `${lines.join("\n")}${lines.length > 0 ? "\n" : ""}`;
}

export function executePluginStructuredDataOperation(input: {
  createError: (message: string) => Error;
  operation: unknown;
  payload: unknown;
}): unknown {
  const { createError, operation, payload } = input;
  if (typeof operation !== "string") {
    throw createError("Plugin structured data operation must be a string.");
  }
  switch (operation) {
    case "toml.parse":
      return bunStructuredDataApis.TOML.parse(String(payload));
    case "toml.stringify":
      return bunStructuredDataApis.TOML.stringify
        ? bunStructuredDataApis.TOML.stringify(payload)
        : stringifyTomlDocument(payload);
    case "yaml.parse":
      return bunStructuredDataApis.YAML.parse(String(payload));
    case "yaml.stringify":
      return bunStructuredDataApis.YAML.stringify?.(payload);
    case "html.toMarkdown":
      return convertHtmlToMarkdown(String(payload));
    case "html.fromMarkdown":
      return convertMarkdownToHtml(String(payload));
    case "xml.parse": {
      const request =
        payload && typeof payload === "object" && !Array.isArray(payload)
          ? (payload as Record<string, unknown>)
          : { content: payload };
      return parseXmlDocument(request.content, request.options);
    }
    case "xml.encode":
      return encodeXmlText(payload);
    default:
      throw createError(
        `Unknown plugin structured data operation ${operation}.`,
      );
  }
}
