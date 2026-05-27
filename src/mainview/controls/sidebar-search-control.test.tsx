/**
 * @file src/mainview/controls/sidebar-search-control.test.tsx
 * @description Tests for the sidebar search control.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { renderToReadableStream } from "react-dom/server";

import {
  shouldAcceptSidebarSearchInputChange,
  SidebarSearchControl,
} from "./sidebar-search-control";

afterEach(() => {
  Reflect.deleteProperty(globalThis, "document");
});

describe("shouldAcceptSidebarSearchInputChange", () => {
  it("accepts focused search edits and rejects non-focused autofill changes", () => {
    const input = {} as HTMLInputElement;
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: { activeElement: input },
    });

    expect(shouldAcceptSidebarSearchInputChange(input)).toBe(true);

    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: { activeElement: null },
    });

    expect(shouldAcceptSidebarSearchInputChange(input)).toBe(false);
  });

  it("accepts changes when no browser document is present", () => {
    Reflect.deleteProperty(globalThis, "document");

    expect(shouldAcceptSidebarSearchInputChange({} as HTMLInputElement)).toBe(
      true,
    );
  });
});

describe("SidebarSearchControl", () => {
  it("marks the search field as non-autofillable search input", async () => {
    const stream = await renderToReadableStream(
      <SidebarSearchControl value="" onValueChange={() => {}} />,
    );
    await stream.allReady;
    const markup = await new Response(stream).text();

    expect(markup).toContain('type="search"');
    expect(markup).toContain('name="metidos-sidebar-search-query"');
    expect(markup).toContain('autoComplete="off"');
    expect(markup).toContain('aria-autocomplete="none"');
    expect(markup).toContain('data-1p-ignore="true"');
    expect(markup).toContain('data-form-type="other"');
    expect(markup).toContain('data-lpignore="true"');
  });
});
