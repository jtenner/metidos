/**
 * @file src/bun/plugin/core-gmail-plugin.test.ts
 * @description Coverage for the core Gmail plugin helper behavior.
 */

import { describe, expect, it } from "bun:test";
import {
  base64UrlDecodeText,
  base64UrlEncode,
  buildDraftRaw,
  buildMimeMessage,
  extractMessageBody,
  gmailMessageSummary,
  queryString,
  type GmailMessage,
} from "../../../core_plugins/gmail/gmail";

describe("core Gmail plugin", () => {
  it("builds Gmail-safe MIME raw payloads without Node or Google clients", () => {
    const raw = buildDraftRaw({
      bcc: [],
      body: "Hello from Metidos 👋",
      bodyFormat: "plain",
      cc: ["copy@example.com"],
      from: "sender@example.com",
      subject: "Hello 世界",
      to: ["recipient@example.com"],
    });
    const decoded = base64UrlDecodeText(raw);
    expect(decoded).toContain("From: sender@example.com");
    expect(decoded).toContain("To: recipient@example.com");
    expect(decoded).toContain("Cc: copy@example.com");
    expect(decoded).toContain("Subject: =?UTF-8?B?");
    expect(decoded).toContain("Content-Type: text/plain; charset=UTF-8");
    expect(decoded).toContain("Hello from Metidos 👋");
    expect(base64UrlDecodeText(base64UrlEncode("round trip 世界"))).toBe(
      "round trip 世界",
    );
  });

  it("summarizes Gmail payload metadata and extracts body text", () => {
    const message: GmailMessage = {
      id: "msg-1",
      payload: {
        headers: [
          { name: "Subject", value: "Project update" },
          { name: "From", value: "Alice <alice@example.com>" },
          { name: "To", value: "Bob <bob@example.com>" },
          { name: "Date", value: "Sat, 9 May 2026 19:00:00 -0400" },
        ],
        mimeType: "multipart/alternative",
        parts: [
          {
            body: { data: base64UrlEncode("Plain text body") },
            mimeType: "text/plain",
          },
        ],
      },
      snippet: "Project update snippet",
      threadId: "thread-1",
    };

    expect(gmailMessageSummary(message)).toEqual({
      date: "Sat, 9 May 2026 19:00:00 -0400",
      from: "Alice <alice@example.com>",
      id: "msg-1",
      snippet: "Project update snippet",
      subject: "Project update",
      threadId: "thread-1",
      to: "Bob <bob@example.com>",
    });
    expect(extractMessageBody(message)).toEqual({
      body: "Plain text body",
      source: "plain",
    });
    expect(
      queryString({
        format: "metadata",
        metadataHeaders: ["Subject", "From"],
      }),
    ).toBe("format=metadata&metadataHeaders=Subject&metadataHeaders=From");
  });

  it("falls back to stripped html when plain text is unavailable", () => {
    const mime = buildMimeMessage({
      bcc: [],
      body: "<p>Hello &amp; welcome</p>",
      bodyFormat: "html",
      cc: [],
      from: "",
      subject: "HTML",
      to: ["user@example.com"],
    });
    expect(mime).toContain("Content-Type: text/html; charset=UTF-8");

    expect(
      extractMessageBody({
        payload: {
          body: { data: base64UrlEncode("<p>Hello &amp; welcome</p>") },
          mimeType: "text/html",
        },
      }),
    ).toEqual({ body: "Hello & welcome", source: "html" });
  });
});
