/**
 * @file src/mainview/app/tool-call-rendering.test.ts
 * @description Tests for transcript tool-call rendering helpers.
 */

import { describe, expect, it } from "bun:test";

import {
  describeToolCall,
  formatToolCallTextForDisplay,
  parseToolCallArguments,
} from "./tool-call-rendering";

const displayOptions = {
  homeDirectory: "/Users/example",
  supportsTildePath: true,
};

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

describe("formatToolCallTextForDisplay", () => {
  it("replaces home-directory prefixes in command and JSON text", () => {
    expect(
      formatToolCallTextForDisplay(
        '{\n  "path": "/Users/example/src/mainview"\n}',
        displayOptions,
      ),
    ).toBe('{\n  "path": "~/src/mainview"\n}');
    expect(
      formatToolCallTextForDisplay("cd /Users/example && ls", displayOptions),
    ).toBe("cd ~ && ls");
    expect(
      formatToolCallTextForDisplay(
        '{\n  "path": "C:\\\\Users\\\\example\\\\src"\n}',
        {
          homeDirectory: "C:\\Users\\example",
          supportsTildePath: true,
        },
      ),
    ).toBe('{\n  "path": "~\\\\src"\n}');
    expect(
      formatToolCallTextForDisplay('"/Users/example2"', displayOptions),
    ).toBe('"/Users/example2"');
  });
});

describe("describeToolCall", () => {
  it("builds a read preview from path and paging arguments", () => {
    expect(
      describeToolCall(
        "read",
        '{\n  "path": "/Users/example/src/bun/README.md",\n  "offset": 40,\n  "limit": 20\n}',
        "completed",
        displayOptions,
      ),
    ).toEqual({
      outputLabel: "Contents",
      preview: "~/src/bun/README.md (offset 40, limit 20)",
    });
  });

  it("builds a read preview from escaped windows paths", () => {
    expect(
      describeToolCall(
        "read",
        '{\n  "path": "C:\\\\Users\\\\example\\\\src\\\\mainview\\\\App.tsx"\n}',
        "completed",
        {
          homeDirectory: "C:\\Users\\example",
          supportsTildePath: true,
        },
      ),
    ).toEqual({
      outputLabel: "Contents",
      preview: "~\\src\\mainview\\App.tsx",
    });
  });

  it("builds a find preview from pattern and root path", () => {
    expect(
      describeToolCall(
        "find",
        '{\n  "pattern": "**/*.test.ts",\n  "path": "/Users/example/src/mainview"\n}',
        "completed",
        displayOptions,
      ),
    ).toEqual({
      outputLabel: "Matches",
      preview: "**/*.test.ts in ~/src/mainview",
    });
  });

  it("builds a grep preview from pattern, path, and qualifiers", () => {
    expect(
      describeToolCall(
        "grep",
        '{\n  "pattern": "tool_call",\n  "path": "/Users/example/src/mainview",\n  "glob": "*.tsx",\n  "caseInsensitive": true,\n  "limit": 25\n}',
        "completed",
        displayOptions,
      ),
    ).toEqual({
      outputLabel: "Matches",
      preview: "tool_call in ~/src/mainview (*.tsx, ignore case, limit 25)",
    });
  });

  it("builds a bash preview from command text", () => {
    expect(
      describeToolCall(
        "bash",
        '{\n  "command": "cd /Users/example && ls"\n}',
        "completed",
        displayOptions,
      ),
    ).toEqual({
      outputLabel: "Command",
      preview: "cd ~ && ls",
    });
  });

  it("builds edit and write previews with operation counts", () => {
    expect(
      describeToolCall(
        "edit",
        '{\n  "path": "/Users/example/src/mainview/app/message-ui.tsx",\n  "edits": [{ "oldText": "before", "newText": "after" }, { "oldText": "x", "newText": "y" }]\n}',
        "completed",
        displayOptions,
      ),
    ).toEqual({
      outputLabel: "Result",
      preview: "~/src/mainview/app/message-ui.tsx (2 edit blocks)",
    });

    expect(
      describeToolCall(
        "write",
        '{\n  "path": "/Users/example/src/mainview/app/tool-call-rendering.ts",\n  "content": "line 1\\nline 2\\nline 3"\n}',
        "completed",
        displayOptions,
      ),
    ).toEqual({
      outputLabel: "Result",
      preview: "~/src/mainview/app/tool-call-rendering.ts (3 lines)",
    });
  });

  it("builds a sqlite preview from the database path and statement type", () => {
    expect(
      describeToolCall(
        "sqlite",
        '{\n  "path": "data/app.sqlite",\n  "query": "select * from notes order by id"\n}',
        "completed",
        displayOptions,
      ),
    ).toEqual({
      outputLabel: "Result",
      preview: "data/app.sqlite (SELECT)",
    });
  });

  it("builds LanceDB previews from path and operation arguments", () => {
    expect(
      describeToolCall(
        "lancedb_upsert",
        '{\n  "path": "vectors/notes",\n  "props": { "id": 7, "vector": [1, 0], "title": "Note" }\n}',
        "completed",
        displayOptions,
      ),
    ).toEqual({
      outputLabel: "Result",
      preview: "vectors/notes (upsert id 7)",
    });

    expect(
      describeToolCall(
        "lancedb_query",
        '{\n  "path": "vectors/notes",\n  "query": "release notes"\n}',
        "completed",
        displayOptions,
      ),
    ).toEqual({
      outputLabel: "Result",
      preview: "vectors/notes (query release notes)",
    });

    expect(
      describeToolCall(
        "lancedb_delete",
        '{\n  "path": "vectors/notes",\n  "id": 7\n}',
        "completed",
        displayOptions,
      ),
    ).toEqual({
      outputLabel: "Result",
      preview: "vectors/notes (delete id 7)",
    });
  });

  it("keeps failed tool calls on an error label", () => {
    expect(
      describeToolCall(
        "ls",
        '{\n  "path": "/Users/example/src/mainview"\n}',
        "failed",
        displayOptions,
      ),
    ).toEqual({
      outputLabel: "Error",
      preview: "~/src/mainview",
    });
  });

  it("falls back to compact raw arguments for non-JSON payloads", () => {
    expect(
      describeToolCall(
        "custom_tool",
        "/Users/example/README.md",
        "completed",
        displayOptions,
      ),
    ).toEqual({
      outputLabel: "Output",
      preview: "~/README.md",
    });
  });
});
