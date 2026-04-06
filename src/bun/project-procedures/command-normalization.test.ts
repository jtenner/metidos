/**
 * @file src/bun/project-procedures/command-normalization.test.ts
 * @description Tests for command string normalization.
 */

import { describe, expect, it } from "bun:test";

import { normalizeCommandDisplayText } from "./command-normalization";

describe("normalizeCommandDisplayText", () => {
  it.each([
    ["plain command with no wrapper", "bun run test", "bun run test"],
    ["double-quoted wrapper", '/bin/bash -lc "bun run test"', "bun run test"],
    ["single-quoted wrapper", "/bin/bash -lc 'bun run test'", "bun run test"],
    [
      "leading and trailing spaces",
      '  /bin/bash -lc "cd /tmp && ls"  ',
      "cd /tmp && ls",
    ],
    [
      "extra spaces around flags",
      '/bin/bash    -lc    "echo hello"',
      "echo hello",
    ],
    [
      "preserves plain command when prefix is different",
      'node /bin/bash -lc "echo nope"',
      'node /bin/bash -lc "echo nope"',
    ],
    [
      "does not treat non-wrapper as command",
      '/bin/bash -lc "missing quote',
      '/bin/bash -lc "missing quote',
    ],
    [
      "does not unwrap if closing quote mismatches",
      "/bin/bash -lc \"mixed quote'",
      "/bin/bash -lc \"mixed quote'",
    ],
    ["unwrapped empty command", "", ""],
    ["wrapped empty single quote command", "/bin/bash -lc ''", ""],
    ["wrapped empty double quote command", '/bin/bash -lc ""', ""],
    [
      "keeps /usr/bin/bash wrappers untouched",
      '/usr/bin/bash -lc "echo nope"',
      '/usr/bin/bash -lc "echo nope"',
    ],
    [
      "decodes double-escaped quotes",
      '/bin/bash -lc "echo \\"hello\\""',
      'echo "hello"',
    ],
    [
      "decodes escaped newline escapes",
      "/bin/bash -lc \"printf 'line1\\nline2'\"",
      "printf 'line1\nline2'",
    ],
    [
      "fallback leaves invalid JSON escapes as best-effort plain text",
      '/bin/bash -lc "printf \\\\x"',
      "printf \\x",
    ],
    [
      "preserves inline && and ||",
      '/bin/bash -lc "test -f file && echo ok || echo fail"',
      "test -f file && echo ok || echo fail",
    ],
    [
      "unwraps command containing semicolons",
      '/bin/bash -lc "ls; echo done"',
      "ls; echo done",
    ],
    [
      "unwraps command with redirections",
      "/bin/bash -lc \"cat > /tmp/out.txt <<'EOF'\"",
      "cat > /tmp/out.txt <<'EOF'",
    ],
    [
      "unwraps command with quotes and spaces",
      '/bin/bash -lc "echo \'a b c\' && echo \\"\\""',
      "echo 'a b c' && echo \"\"",
    ],
    [
      "does not mutate unrelated commands containing shell tokens",
      "echo '/bin/bash -lc \"echo nope\" inside string'",
      "echo '/bin/bash -lc \"echo nope\" inside string'",
    ],
    [
      "handles tabs and newlines as part of the wrapper body",
      '/bin/bash -lc "\tcd /tmp\\nls -la"',
      "\tcd /tmp\nls -la",
    ],
    [
      "works with command-like text after trimming",
      '\t/bin/bash -lc "pwd" \n',
      "pwd",
    ],
    [
      "keeps single quoted escaped sequences unchanged",
      "/bin/bash -lc 'echo \\\"single\\\"'",
      'echo \\"single\\"',
    ],
  ])("%s", (_, input, expected) => {
    expect(normalizeCommandDisplayText(input)).toBe(expected);
  });

  it("handles many distinct real-world shell strings", () => {
    const inputs = [
      '/bin/bash -lc "cd /repo && bun run lint"',
      "/bin/bash -lc 'git status --short'",
      "/bin/bash -lc \"printf 'line1\\nline2'\"",
      "bun run test",
      "docker run --rm node:20 node -e \"console.log('noisy')\"",
    ];
    const expected = [
      "cd /repo && bun run lint",
      "git status --short",
      "printf 'line1\nline2'",
      "bun run test",
      "docker run --rm node:20 node -e \"console.log('noisy')\"",
    ];

    expect(inputs.map((value) => normalizeCommandDisplayText(value))).toEqual(
      expected,
    );
  });
});
