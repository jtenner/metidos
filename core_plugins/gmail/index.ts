import { definePlugin, type MetidosPluginApi } from "@metidos/plugin-api";
import {
  buildDraftRaw,
  extractMessageBody,
  formEncode,
  gmailMessageSummary,
  markdownEscapeCell,
  queryString,
  truncateText,
  type DraftMessageInput,
  type GmailMessage,
} from "./gmail";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_API_BASE_URL = "https://gmail.googleapis.com/gmail/v1/users/me";
const METADATA_HEADERS = ["Subject", "From", "To", "Date"];

const MESSAGE_ID_PATTERN = /^[A-Za-z0-9_-]{1,256}$/u;
const EMAIL_HEADER_PATTERN =
  /^[^\s@<>"(),:;\\[\]]+@[^\s@<>"(),:;\\[\]]+\.[^\s@<>"(),:;\\[\]]+$/u;

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === "object"
    ? (input as Record<string, unknown>)
    : {};
}

function boundedString(input: unknown, max: number): string {
  return typeof input === "string" ? input.trim().slice(0, max) : "";
}

function integerInRange(
  input: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = typeof input === "number" ? input : Number(input);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function booleanValue(input: unknown, fallback = false): boolean {
  return typeof input === "boolean" ? input : fallback;
}

function validateId(input: unknown, label: string): string {
  const value = boundedString(input, 256);
  if (!MESSAGE_ID_PATTERN.test(value)) {
    throw new Error(`${label} must be a Gmail id string.`);
  }
  return value;
}

function emailList(input: unknown, label: string, maxItems: number): string[] {
  const rawItems = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? input.split(",")
      : [];
  const items = rawItems
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .slice(0, maxItems);
  for (const item of items) {
    if (/[\r\n]/u.test(item) || item.length > 320) {
      throw new Error(`${label} contains an invalid address.`);
    }
    const plainAddress = /<([^<>]+)>\s*$/u.exec(item)?.[1]?.trim() ?? item;
    if (!EMAIL_HEADER_PATTERN.test(plainAddress)) {
      throw new Error(`${label} contains an invalid address.`);
    }
  }
  return items;
}

function optionalEmail(input: unknown, label: string): string {
  const value = boundedString(input, 320);
  if (!value) return "";
  if (/[\r\n]/u.test(value)) {
    throw new Error(`${label} contains an invalid address.`);
  }
  const plainAddress = /<([^<>]+)>\s*$/u.exec(value)?.[1]?.trim() ?? value;
  if (!EMAIL_HEADER_PATTERN.test(plainAddress)) {
    throw new Error(`${label} contains an invalid address.`);
  }
  return value;
}

function firstNonEmptyString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function requireGmailSetting(value: unknown, label: string): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  throw new Error(
    `Configure the Gmail ${label} setting before using this tool.`,
  );
}

function gmailOAuthConfig(metidos: MetidosPluginApi): {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
} {
  const clientId = firstNonEmptyString(
    metidos.settings.get("client_id"),
    metidos.env.get("GMAIL_CLIENT_ID"),
  );
  const clientSecret = firstNonEmptyString(
    metidos.settings.get("client_secret"),
    metidos.env.get("GMAIL_CLIENT_SECRET"),
  );
  return {
    clientId: requireGmailSetting(clientId, "OAuth client ID"),
    clientSecret: requireGmailSetting(clientSecret, "OAuth client secret"),
    refreshToken: requireGmailSetting(
      metidos.settings.get("refresh_token"),
      "refresh token",
    ),
  };
}

function configuredFromAddress(
  metidos: MetidosPluginApi,
  requested?: string,
): string {
  const configured =
    requested || firstNonEmptyString(metidos.settings.get("send_as_email"));
  return configured
    ? optionalEmail(configured, requested ? "from" : "send_as_email")
    : "";
}

function parseJsonText(text: string, label: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${label} returned invalid JSON.`);
  }
}

function googleErrorMessage(data: unknown): string | null {
  const record = asRecord(data);
  const error = record.error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const nested = error as Record<string, unknown>;
    if (typeof nested.message === "string") return nested.message.slice(0, 240);
  }
  if (typeof record.error_description === "string") {
    return record.error_description.slice(0, 240);
  }
  return null;
}

async function refreshAccessToken(metidos: MetidosPluginApi): Promise<string> {
  const config = gmailOAuthConfig(metidos);
  const response = await metidos.fetch(GOOGLE_TOKEN_URL, {
    body: formEncode({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
      refresh_token: config.refreshToken,
    }),
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  });
  const text = await response.text();
  const data = parseJsonText(text, "Google OAuth token endpoint");
  if (!response.ok) {
    const detail = googleErrorMessage(data);
    throw new Error(
      `Gmail OAuth refresh failed (${response.status})${detail ? `: ${detail}` : "."}`,
    );
  }
  const accessToken = asRecord(data).access_token;
  if (typeof accessToken !== "string" || !accessToken) {
    throw new Error("Gmail OAuth refresh did not return an access token.");
  }
  return accessToken;
}

async function gmailRequest(
  metidos: MetidosPluginApi,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<unknown> {
  const accessToken = await refreshAccessToken(metidos);
  const response = await metidos.fetch(`${GMAIL_API_BASE_URL}${path}`, {
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    method,
  });
  const text = await response.text();
  const data = parseJsonText(text, "Gmail API");
  if (!response.ok) {
    const detail = googleErrorMessage(data);
    throw new Error(
      `Gmail API request failed (${response.status})${detail ? `: ${detail}` : "."}`,
    );
  }
  return data;
}

type SearchProps = {
  includeSpamTrash: boolean;
  maxResults: number;
  query: string;
};

function validateSearchProps(input: unknown): SearchProps {
  const record = asRecord(input);
  return {
    includeSpamTrash: booleanValue(record.include_spam_trash),
    maxResults: integerInRange(record.max_results, 5, 1, 10),
    query: boundedString(record.query, 500),
  };
}

type ReadProps = {
  id: string;
  maxBodyChars: number;
};

function validateReadProps(input: unknown): ReadProps {
  const record = asRecord(input);
  return {
    id: validateId(record.id ?? record.message_id, "id"),
    maxBodyChars: integerInRange(record.max_body_chars, 6000, 1000, 20000),
  };
}

type CreateDraftProps = DraftMessageInput;

function validateCreateDraftProps(input: unknown): CreateDraftProps {
  const record = asRecord(input);
  const to = emailList(record.to, "to", 20);
  if (to.length === 0) throw new Error("to must contain at least one address.");
  const body = boundedString(record.body, 20000);
  if (!body) throw new Error("body is required.");
  return {
    bcc: emailList(record.bcc, "bcc", 20),
    body,
    bodyFormat: record.body_format === "html" ? "html" : "plain",
    cc: emailList(record.cc, "cc", 20),
    from: optionalEmail(record.from, "from"),
    subject: boundedString(record.subject, 300) || "(no subject)",
    to,
  };
}

function searchMarkdown(
  summaries: ReturnType<typeof gmailMessageSummary>[],
): string {
  if (summaries.length === 0) {
    return "No Gmail messages matched the query.";
  }
  return [
    "| Message ID | Date | From | Subject | Snippet |",
    "|---|---|---|---|---|",
    ...summaries.map(
      (message) =>
        `| ${markdownEscapeCell(message.id)} | ${markdownEscapeCell(message.date)} | ${markdownEscapeCell(message.from)} | ${markdownEscapeCell(message.subject)} | ${markdownEscapeCell(message.snippet)} |`,
    ),
  ].join("\n");
}

function readMarkdown(message: GmailMessage, maxBodyChars: number): string {
  const summary = gmailMessageSummary(message);
  const extracted = extractMessageBody(message);
  const body = extracted.body
    ? truncateText(extracted.body, maxBodyChars)
    : "[No text/plain or text/html body was available in this message.]";
  return [
    `# ${summary.subject}`,
    "",
    `- Message ID: \`${summary.id}\``,
    `- Thread ID: \`${summary.threadId}\``,
    `- Date: ${summary.date || "unknown"}`,
    `- From: ${summary.from || "unknown"}`,
    `- To: ${summary.to || "unknown"}`,
    `- Body source: ${extracted.source}`,
    "",
    "```text",
    body.replace(/```/gu, "` ` `"),
    "```",
  ].join("\n");
}

export default definePlugin((metidos) => {
  metidos.addAgentTool({
    tool: "gmail_search",
    name: "Gmail search",
    description:
      "Search Gmail messages with Gmail query syntax and return bounded message metadata.",
    timeoutMs: 30_000,
    validateProps: validateSearchProps,
    async action(_context, props) {
      const listQuery = queryString({
        includeSpamTrash: props.includeSpamTrash,
        maxResults: props.maxResults,
        ...(props.query ? { q: props.query } : {}),
      });
      const listData = asRecord(
        await gmailRequest(metidos, "GET", `/messages?${listQuery}`),
      );
      const messages = Array.isArray(listData.messages)
        ? listData.messages.slice(0, props.maxResults)
        : [];
      const summaries = [];
      for (const item of messages) {
        const id = validateId(asRecord(item).id, "message id");
        const detailsQuery = queryString({
          format: "metadata",
          metadataHeaders: METADATA_HEADERS,
        });
        const details = (await gmailRequest(
          metidos,
          "GET",
          `/messages/${encodeURIComponent(id)}?${detailsQuery}`,
        )) as GmailMessage;
        summaries.push(gmailMessageSummary(details));
      }
      return { markdown: searchMarkdown(summaries), type: "markdown" };
    },
  });

  metidos.addAgentTool({
    tool: "gmail_read",
    name: "Gmail read",
    description:
      "Read one Gmail message by message id and return headers plus a bounded text body.",
    timeoutMs: 30_000,
    validateProps: validateReadProps,
    async action(_context, props) {
      const details = (await gmailRequest(
        metidos,
        "GET",
        `/messages/${encodeURIComponent(props.id)}?format=full`,
      )) as GmailMessage;
      return {
        markdown: readMarkdown(details, props.maxBodyChars),
        type: "markdown",
      };
    },
  });

  metidos.addAgentTool({
    tool: "gmail_create_draft",
    name: "Gmail create draft",
    description:
      "Create a Gmail draft from recipients, subject, and bounded body text. Does not send the draft.",
    timeoutMs: 30_000,
    validateProps: validateCreateDraftProps,
    async action(_context, props) {
      const from = configuredFromAddress(metidos, props.from);
      const raw = buildDraftRaw({ ...props, from });
      const draft = asRecord(
        await gmailRequest(metidos, "POST", "/drafts", {
          message: { raw },
        }),
      );
      const message = asRecord(draft.message);
      return {
        markdown: [
          "Created Gmail draft.",
          "",
          `- Draft ID: \`${markdownEscapeCell(draft.id)}\``,
          `- Message ID: \`${markdownEscapeCell(message.id)}\``,
          `- Thread ID: \`${markdownEscapeCell(message.threadId)}\``,
        ].join("\n"),
        type: "markdown",
      };
    },
  });
});
