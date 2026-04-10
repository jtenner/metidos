/**
 * @file src/mainview/app/tool-call-rendering.test.ts
 * @description Tests for transcript tool-call rendering helpers.
 */

import { describe, expect, it } from "bun:test";

import {
  describeToolCall,
  parseToolCallArguments,
} from "./tool-call-rendering";

describe("parseToolCallArguments", () => {
  it("parses persisted JSON arguments when valid", () => {
    expect(
      parseToolCallArguments('{\n  "path": "src/mainview/App.tsx"\n}'),
    ).toEqual({
      path: "src/mainview/App.tsx",
    });
  });

  it("returns null for invalid persisted argument text", () => {
    expect(parseToolCallArguments("{not valid json")).toBeNull();
  });
});

describe("describeToolCall", () => {
  it("builds a read preview from path and paging arguments", () => {
    expect(
      describeToolCall(
        "read",
        '{\n  "path": "src/bun/README.md",\n  "offset": 40,\n  "limit": 20\n}',
        "completed",
      ),
    ).toEqual({
      outputLabel: "Contents",
      preview: "src/bun/README.md (offset 40, limit 20)",
    });
  });

  it("builds a find preview from pattern and root path", () => {
    expect(
      describeToolCall(
        "find",
        '{\n  "pattern": "**/*.test.ts",\n  "path": "src/mainview"\n}',
        "completed",
      ),
    ).toEqual({
      outputLabel: "Matches",
      preview: "**/*.test.ts in src/mainview",
    });
  });

  it("builds a grep preview from pattern, path, and qualifiers", () => {
    expect(
      describeToolCall(
        "grep",
        '{\n  "pattern": "tool_call",\n  "path": "src/mainview",\n  "glob": "*.tsx",\n  "caseInsensitive": true,\n  "limit": 25\n}',
        "completed",
      ),
    ).toEqual({
      outputLabel: "Matches",
      preview: "tool_call in src/mainview (*.tsx, ignore case, limit 25)",
    });
  });

  it("builds edit and write previews with operation counts", () => {
    expect(
      describeToolCall(
        "edit",
        '{\n  "path": "src/mainview/app/message-ui.tsx",\n  "edits": [{ "oldText": "before", "newText": "after" }, { "oldText": "x", "newText": "y" }]\n}',
        "completed",
      ),
    ).toEqual({
      outputLabel: "Result",
      preview: "src/mainview/app/message-ui.tsx (2 edit blocks)",
    });

    expect(
      describeToolCall(
        "write",
        '{\n  "path": "src/mainview/app/tool-call-rendering.ts",\n  "content": "line 1\\nline 2\\nline 3"\n}',
        "completed",
      ),
    ).toEqual({
      outputLabel: "Result",
      preview: "src/mainview/app/tool-call-rendering.ts (3 lines)",
    });
  });

  it("keeps failed tool calls on an error label", () => {
    expect(
      describeToolCall("ls", '{\n  "path": "src/mainview"\n}', "failed"),
    ).toEqual({
      outputLabel: "Error",
      preview: "src/mainview",
    });
  });

  it("falls back to compact raw arguments for non-JSON payloads", () => {
    expect(describeToolCall("custom_tool", "README.md", "completed")).toEqual({
      outputLabel: "Output",
      preview: "README.md",
    });
  });
});
