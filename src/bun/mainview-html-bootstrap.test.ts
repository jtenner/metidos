import { describe, expect, it } from "bun:test";
import {
  escapeInlineJsonForHtml,
  injectMainviewHtmlBootstrapElement,
} from "./mainview-html-bootstrap";

describe("Mainview HTML bootstrap injection", () => {
  it("escapes JSON so script-like content stays inside the bootstrap container", () => {
    const unsafeJson = JSON.stringify({
      value: "</script><script>alert('xss')</script>&\u2028next\u2029",
    });

    const escaped = escapeInlineJsonForHtml(unsafeJson);

    expect(escaped).not.toContain("</script>");
    expect(escaped).not.toContain("<script>");
    expect(escaped).not.toContain("&");
    expect(escaped).toContain("\\u003c\\/script\\u003e");
    expect(JSON.parse(escaped)).toEqual(JSON.parse(unsafeJson));
  });

  it("escapes JSON control characters while preserving parseability", () => {
    const unsafeJsonWithRawControls =
      '{"value":"nul:\u0000 tab:\t newline:\n"}';

    const escaped = escapeInlineJsonForHtml(unsafeJsonWithRawControls);

    expect(escaped).toContain("\\u0000");
    expect(escaped).toContain("\\u0009");
    expect(escaped).toContain("\\u000a");
    expect(JSON.parse(escaped)).toEqual({
      value: "nul:\u0000 tab:\t newline:\n",
    });
  });

  it("keeps request-specific bootstrap data out of cached static HTML", () => {
    const cachedStaticHtml =
      "<html><head><title>Metidos</title></head><body></body></html>";
    const firstBootstrap =
      '<script type="application/json" id="metidos-mainview-bootstrap">{"request":1}</script>';
    const secondBootstrap =
      '<script type="application/json" id="metidos-mainview-bootstrap">{"request":2}</script>';

    const firstHtml = injectMainviewHtmlBootstrapElement(
      cachedStaticHtml,
      firstBootstrap,
    );
    const secondHtml = injectMainviewHtmlBootstrapElement(
      cachedStaticHtml,
      secondBootstrap,
    );

    expect(cachedStaticHtml).not.toContain("metidos-mainview-bootstrap");
    expect(firstHtml).toContain('{"request":1}');
    expect(firstHtml).not.toContain('{"request":2}');
    expect(secondHtml).toContain('{"request":2}');
    expect(secondHtml).not.toContain('{"request":1}');
  });
});
