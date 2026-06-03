import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ContextUsageMeter } from "./ContextUsageMeter";

describe("ContextUsageMeter", () => {
  it("renders accessible meter text and values for context limit labels", () => {
    const html = renderToStaticMarkup(
      <ContextUsageMeter inputTokens={256} contextWindowTokens={1024} />,
    );

    expect(html).toContain('aria-label="Context usage"');
    expect(html).toContain('max="1024"');
    expect(html).toContain('min="0"');
    expect(html).toContain('value="256"');
    expect(html).toContain("256 of 1,024 context tokens used");
  });

  it("clamps unsafe token counts while preserving the displayed raw context label", () => {
    const oversizedHtml = renderToStaticMarkup(
      <ContextUsageMeter inputTokens={2048} contextWindowTokens={512} />,
    );
    const emptyWindowHtml = renderToStaticMarkup(
      <ContextUsageMeter inputTokens={10} contextWindowTokens={0} />,
    );
    const negativeHtml = renderToStaticMarkup(
      <ContextUsageMeter inputTokens={-7} contextWindowTokens={128} />,
    );

    expect(oversizedHtml).toContain('max="512"');
    expect(oversizedHtml).toContain('value="512"');
    expect(oversizedHtml).toContain("2,048 of 512 context tokens used");

    expect(emptyWindowHtml).toContain('max="1"');
    expect(emptyWindowHtml).toContain('value="1"');
    expect(emptyWindowHtml).toContain("10 of 0 context tokens used");

    expect(negativeHtml).toContain('max="128"');
    expect(negativeHtml).toContain('value="0"');
    expect(negativeHtml).toContain("-7 of 128 context tokens used");
  });
});
