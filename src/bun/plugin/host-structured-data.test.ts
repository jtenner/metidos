import { describe, expect, test } from "bun:test";
import {
  executePluginStructuredDataOperation,
  stringifyTomlDocument,
} from "./host-structured-data";

class TestStructuredDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TestStructuredDataError";
  }
}

function execute(operation: unknown, payload: unknown): unknown {
  return executePluginStructuredDataOperation({
    createError: (message) => new TestStructuredDataError(message),
    operation,
    payload,
  });
}

describe("plugin host structured data operations", () => {
  test("parses and stringifies TOML with the shared fallback stringifier", () => {
    expect(execute("toml.parse", "title = 'Metidos'\n")).toEqual({
      title: "Metidos",
    });
    expect(
      stringifyTomlDocument({
        nested: { enabled: true },
        title: "Metidos",
      }),
    ).toBe('title = "Metidos"\n\n[nested]\nenabled = true\n');
  });

  test("parses and stringifies YAML through the shared operation dispatcher", () => {
    expect(execute("yaml.parse", "title: Metidos\n")).toEqual({
      title: "Metidos",
    });
    expect(String(execute("yaml.stringify", { title: "Metidos" }))).toContain(
      "title: Metidos",
    );
  });

  test("converts HTML, Markdown, and XML through one language-neutral path", () => {
    expect(execute("html.toMarkdown", "<strong>Hello</strong>")).toContain(
      "Hello",
    );
    expect(execute("html.fromMarkdown", "**Hello**")).toContain("strong");
    expect(execute("xml.encode", "<tag>&value</tag>")).toBe(
      "&lt;tag&gt;&amp;value&lt;/tag&gt;",
    );
    expect(
      execute("xml.parse", { content: "<root><item>1</item></root>" }),
    ).toMatchObject({
      name: "root",
    });
  });

  test("uses adapter-provided error construction for unsupported operations", () => {
    expect(() => execute(42, null)).toThrow(TestStructuredDataError);
    expect(() => execute("unknown.operation", null)).toThrow(
      "Unknown plugin structured data operation unknown.operation.",
    );
  });
});
