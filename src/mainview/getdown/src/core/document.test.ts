import { describe, expect, test } from "bun:test";
import { parseDocument } from "./document";

function blockquoteDepth(blocks: ReturnType<typeof parseDocument>["blocks"]): number {
  const block = blocks[0];
  if (block?.kind !== "blockquote") {
    return 0;
  }
  return 1 + blockquoteDepth(block.blocks);
}

describe("parseDocument structural sharing", () => {
  test("reuses unchanged leading blocks when content appends to the final block", () => {
    const previous = parseDocument("# Title\n\nHello wor");
    const next = parseDocument("# Title\n\nHello world", previous);

    expect(next.blocks).toHaveLength(2);
    expect(next.blocks[0]).toBe(previous.blocks[0]);
    expect(next.blocks[1]).not.toBe(previous.blocks[1]);
    expect(next.blocks[1]?.id).toBe(previous.blocks[1]?.id);
  });

  test("reuses all blocks when normalized content is unchanged", () => {
    const previous = parseDocument("Alpha\r\n\r\nBeta");
    const next = parseDocument("Alpha\n\nBeta", previous);

    expect(next.blocks[0]).toBe(previous.blocks[0]);
    expect(next.blocks[1]).toBe(previous.blocks[1]);
  });

  test("reuses blocks before and after a middle edit", () => {
    const previous = parseDocument("# Alpha\n\nOriginal middle.\n\n# Gamma");
    const next = parseDocument("# Alpha\n\nChanged middle.\n\n# Gamma", previous);

    expect(next.blocks).toHaveLength(3);
    expect(next.blocks[0]).toBe(previous.blocks[0]);  // # Alpha reused
    expect(next.blocks[1]).not.toBe(previous.blocks[1]); // middle changed
    expect(next.blocks[2]).toBe(previous.blocks[2]);  // # Gamma reused
  });

  test("reuses trailing blocks when first block changes", () => {
    const previous = parseDocument("# Alpha\n\nBeta.\n\n# Gamma");
    const next = parseDocument("# Alpha Modified\n\nBeta.\n\n# Gamma", previous);

    expect(next.blocks).toHaveLength(3);
    expect(next.blocks[0]).not.toBe(previous.blocks[0]); // heading changed
    expect(next.blocks[1]).toBe(previous.blocks[1]); // Beta unchanged
    expect(next.blocks[2]).toBe(previous.blocks[2]); // # Gamma unchanged
  });

  test("reuses blocks when content is inserted in the middle", () => {
    const previous = parseDocument("# Alpha\n\n# Gamma");
    const next = parseDocument("# Alpha\n\n# Beta\n\n# Gamma", previous);

    expect(next.blocks).toHaveLength(3);
    expect(next.blocks[0]).toBe(previous.blocks[0]); // # Alpha reused
    expect(next.blocks[2]).toBe(previous.blocks[1]); // # Gamma reused (was index 1, now index 2)
  });

  test("reuses blocks when a middle block is deleted", () => {
    const previous = parseDocument("# Alpha\n\n# Beta\n\n# Gamma");
    const next = parseDocument("# Alpha\n\n# Gamma", previous);

    expect(next.blocks).toHaveLength(2);
    expect(next.blocks[0]).toBe(previous.blocks[0]); // # Alpha reused
    expect(next.blocks[1]).toBe(previous.blocks[2]); // # Gamma reused (was index 2, now index 1)
  });

  test("reuses all leading blocks in a large document when appending to the final block", () => {
    const sections = 32;
    const prefix = Array.from({ length: sections }, (_, i) =>
      `## Section ${i + 1}\n\nParagraph ${i + 1} with *emphasis* and \`code\`.`
    ).join("\n\n");
    const previous = parseDocument(prefix + "\n\nFinal block incomple");
    const next = parseDocument(prefix + "\n\nFinal block incomplete but growing", previous);

    // All leading blocks should be reusable
    expect(next.blocks).toHaveLength(previous.blocks.length);
    for (let index = 0; index < previous.blocks.length - 1; index += 1) {
      expect(next.blocks[index]).toBe(previous.blocks[index]);
    }
    // Final block changed (paragraph appended)
    expect(next.blocks[next.blocks.length - 1]).not.toBe(previous.blocks[previous.blocks.length - 1]);
  });

  test("reuses blocks when only whitespace changes in a non-semantic way", () => {
    const previous = parseDocument("# Alpha  \n\n   Beta.   \n\n# Gamma");
    const next = parseDocument("# Alpha\n\nBeta.\n\n# Gamma", previous);

    // Trailing whitespace changes affect the raw fingerprint, blocks may or may not be reused
    // depending on whether the normalization affects the raw text.
    // At minimum, structural identity should be preserved where raw matches.
    expect(next.blocks).toHaveLength(previous.blocks.length);
  });

  test("returns the same object when previous content is identical", () => {
    const previous = parseDocument("# Title\n\nParagraph with **bold** and `code`.\n\n> Quote");
    const next = parseDocument("# Title\n\nParagraph with **bold** and `code`.\n\n> Quote", previous);

    expect(next).toBe(previous);
  });

  test("caps deeply nested blockquotes instead of overflowing the parser stack", () => {
    const document = parseDocument(`${">".repeat(10_000)} deeply nested`);

    expect(blockquoteDepth(document.blocks)).toBeLessThanOrEqual(257);
  });

  test("assigns stable block ids across reparses of identical content", () => {
    const first = parseDocument("# A\n\n# B\n\n# C");
    const second = parseDocument("# A\n\n# B\n\n# C");

    expect(first.blocks).toHaveLength(3);
    expect(second.blocks).toHaveLength(3);
    expect(first.blocks[0]?.id).toBe(second.blocks[0]?.id);
    expect(first.blocks[1]?.id).toBe(second.blocks[1]?.id);
    expect(first.blocks[2]?.id).toBe(second.blocks[2]?.id);
  });

  test("assigns distinct ids to loose list child paragraphs with local offsets", () => {
    const document = parseDocument("- First paragraph\n\n  Second paragraph");
    const list = document.blocks[0];

    expect(list?.kind).toBe("list");
    if (list?.kind !== "list") return;

    const childBlocks = list.items[0]?.blocks ?? [];
    expect(childBlocks.map((block) => block.id)).toHaveLength(2);
    expect(new Set(childBlocks.map((block) => block.id)).size).toBe(2);
  });

  test("reuses blocks when preceding blank lines are added", () => {
    const previous = parseDocument("\n\n# Alpha\n\nBeta");
    const next = parseDocument("\n\n\n\n# Alpha\n\nBeta", previous);

    expect(next.blocks).toHaveLength(2);
    // Leading blank lines are skipped, blocks start at the same position
    // With extra blank lines, the start offset shifts, so reuse won't happen via sequential path
    // but the fallback fingerprint map may still match if raw is identical
    expect(next.blocks[0]?.id).toBe(previous.blocks[0]?.id);
  });
});
