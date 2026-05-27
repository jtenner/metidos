export type GmailHeader = {
  name?: unknown;
  value?: unknown;
};

export type GmailMessagePayload = {
  body?: { data?: unknown } | null;
  headers?: GmailHeader[] | null;
  mimeType?: unknown;
  parts?: GmailMessagePayload[] | null;
};

export type GmailMessage = {
  id?: unknown;
  internalDate?: unknown;
  labelIds?: unknown;
  payload?: GmailMessagePayload | null;
  snippet?: unknown;
  threadId?: unknown;
};

export type GmailMessageSummary = {
  date: string;
  from: string;
  id: string;
  snippet: string;
  subject: string;
  threadId: string;
  to: string;
};

export type DraftMessageInput = {
  bcc: string[];
  body: string;
  bodyFormat: "html" | "plain";
  cc: string[];
  from: string;
  subject: string;
  to: string[];
};

const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_LOOKUP = (() => {
  const lookup: Record<string, number> = {};
  for (let index = 0; index < BASE64_ALPHABET.length; index += 1) {
    lookup[BASE64_ALPHABET[index] ?? ""] = index;
  }
  return lookup;
})();

function textBytes(value: string): number[] {
  if (typeof TextEncoder === "function") {
    return Array.from(new TextEncoder().encode(value));
  }
  return Array.from(value, (char) => char.charCodeAt(0) & 0xff);
}

function bytesText(bytes: Uint8Array): string {
  if (typeof TextDecoder === "function") {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }
  let output = "";
  for (const byte of bytes) output += String.fromCharCode(byte);
  return output;
}

function base64Encode(value: string): string {
  const bytes = textBytes(value);
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    const combined = (first << 16) | (second << 8) | third;
    output += BASE64_ALPHABET[(combined >> 18) & 63];
    output += BASE64_ALPHABET[(combined >> 12) & 63];
    output +=
      index + 1 < bytes.length ? BASE64_ALPHABET[(combined >> 6) & 63] : "=";
    output += index + 2 < bytes.length ? BASE64_ALPHABET[combined & 63] : "=";
  }
  return output;
}

export function base64UrlEncode(value: string): string {
  return base64Encode(value)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/u, "");
}

export function base64UrlDecodeText(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "=",
  );
  const bytes: number[] = [];
  for (let index = 0; index < padded.length; index += 4) {
    const first = BASE64_LOOKUP[padded[index] ?? ""] ?? 0;
    const second = BASE64_LOOKUP[padded[index + 1] ?? ""] ?? 0;
    const thirdChar = padded[index + 2] ?? "=";
    const fourthChar = padded[index + 3] ?? "=";
    const third = thirdChar === "=" ? 0 : (BASE64_LOOKUP[thirdChar] ?? 0);
    const fourth = fourthChar === "=" ? 0 : (BASE64_LOOKUP[fourthChar] ?? 0);
    const combined = (first << 18) | (second << 12) | (third << 6) | fourth;
    bytes.push((combined >> 16) & 0xff);
    if (thirdChar !== "=") bytes.push((combined >> 8) & 0xff);
    if (fourthChar !== "=") bytes.push(combined & 0xff);
  }
  return bytesText(new Uint8Array(bytes));
}

export function formEncode(values: Record<string, string>): string {
  return Object.entries(values)
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
    )
    .join("&");
}

export function queryString(
  values: Record<string, string | number | boolean | string[] | undefined>,
): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue;
    const items = Array.isArray(value) ? value : [String(value)];
    for (const item of items) {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(item)}`);
    }
  }
  return parts.join("&");
}

function cleanHeaderValue(value: string): string {
  return value
    .replace(/[\r\n]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function headerValue(
  headers: GmailHeader[] | null | undefined,
  name: string,
): string {
  const target = name.toLowerCase();
  const found = (headers ?? []).find(
    (header) =>
      typeof header.name === "string" && header.name.toLowerCase() === target,
  );
  return typeof found?.value === "string" ? cleanHeaderValue(found.value) : "";
}

function safeString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function gmailMessageSummary(
  message: GmailMessage,
): GmailMessageSummary {
  const headers = message.payload?.headers ?? [];
  return {
    date: headerValue(headers, "Date"),
    from: headerValue(headers, "From"),
    id: safeString(message.id),
    snippet: cleanHeaderValue(safeString(message.snippet)),
    subject: headerValue(headers, "Subject") || "(no subject)",
    threadId: safeString(message.threadId),
    to: headerValue(headers, "To"),
  };
}

function htmlToText(value: string): string {
  return value
    .replace(/<\s*br\s*\/?\s*>/giu, "\n")
    .replace(/<\s*\/\s*p\s*>/giu, "\n\n")
    .replace(/<style[\s\S]*?<\/style>/giu, "")
    .replace(/<script[\s\S]*?<\/script>/giu, "")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&quot;/giu, '"')
    .replace(/&#39;/giu, "'")
    .replace(/[ \t]+/gu, " ")
    .replace(/\n\s+/gu, "\n")
    .trim();
}

function collectBodies(
  payload: GmailMessagePayload | null | undefined,
  targetMimeType: "text/html" | "text/plain",
  output: string[],
): void {
  if (!payload) return;
  const mimeType = typeof payload.mimeType === "string" ? payload.mimeType : "";
  const data = typeof payload.body?.data === "string" ? payload.body.data : "";
  if (mimeType.toLowerCase() === targetMimeType && data) {
    output.push(base64UrlDecodeText(data));
  }
  for (const part of payload.parts ?? []) {
    collectBodies(part, targetMimeType, output);
  }
}

export function extractMessageBody(message: GmailMessage): {
  body: string;
  source: "html" | "plain" | "unavailable";
} {
  const plainParts: string[] = [];
  collectBodies(message.payload, "text/plain", plainParts);
  const plain = plainParts.join("\n\n").trim();
  if (plain) return { body: plain, source: "plain" };

  const htmlParts: string[] = [];
  collectBodies(message.payload, "text/html", htmlParts);
  const html = htmlToText(htmlParts.join("\n\n"));
  if (html) return { body: html, source: "html" };

  return { body: "", source: "unavailable" };
}

export function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 35)).trimEnd()}\n\n[truncated to ${maxChars} characters]`;
}

function containsNonAscii(value: string): boolean {
  return /[^\x20-\x7e]/u.test(value);
}

function encodeHeaderIfNeeded(value: string): string {
  const cleaned = cleanHeaderValue(value);
  if (!containsNonAscii(cleaned)) return cleaned;
  return `=?UTF-8?B?${base64Encode(cleaned)}?=`;
}

function headerLine(name: string, value: string): string | null {
  const cleaned = cleanHeaderValue(value);
  if (!cleaned) return null;
  return `${name}: ${encodeHeaderIfNeeded(cleaned)}`;
}

export function buildMimeMessage(input: DraftMessageInput): string {
  const contentType =
    input.bodyFormat === "html"
      ? "text/html; charset=UTF-8"
      : "text/plain; charset=UTF-8";
  const lines = [
    headerLine("From", input.from),
    headerLine("To", input.to.join(", ")),
    headerLine("Cc", input.cc.join(", ")),
    headerLine("Bcc", input.bcc.join(", ")),
    headerLine("Subject", input.subject),
    "MIME-Version: 1.0",
    `Content-Type: ${contentType}`,
    "Content-Transfer-Encoding: 8bit",
    "",
    input.body,
  ].filter((line): line is string => line !== null);
  return lines.join("\r\n");
}

export function buildDraftRaw(input: DraftMessageInput): string {
  return base64UrlEncode(buildMimeMessage(input));
}

export function markdownEscapeCell(value: unknown): string {
  return String(value ?? "")
    .replace(/\|/gu, "\\|")
    .replace(/\r?\n/gu, " ")
    .trim();
}
