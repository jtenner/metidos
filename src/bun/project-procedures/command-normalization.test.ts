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
      "unwraps alternate bash executable path",
      '/usr/bin/bash -lc "echo nope"',
      "echo nope",
    ],
    [
      "unwraps env bash wrapper",
      '/usr/bin/env bash -lc "echo nope"',
      "echo nope",
    ],
    [
      "unwraps screenshot-like git add command",
      '/bin/bash -lc "git add CHANGELOG.md agent-todo.md docs/0073-2026-04-02-code-pushing.md"',
      "git add CHANGELOG.md agent-todo.md docs/0073-2026-04-02-code-pushing.md",
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
    [
      "decodes shell-escaped single quotes in POSIX payloads",
      `/bin/bash -lc 'printf '"'hello'"''`,
      "printf 'hello'",
    ],
    [
      "decodes the post-code-pushing diff inspection command",
      `/bin/bash -lc 'rg -n "''^@@|''^[-+]" .tmp/post-code-pushing-simplify-callfed/simplify.diff | sed -n '"'1,220p'"''`,
      `rg -n "^@@|^[-+]" .tmp/post-code-pushing-simplify-callfed/simplify.diff | sed -n '1,220p'`,
    ],
    ["unwraps unquoted bash command bodies", "/bin/bash -lc pwd", "pwd"],
    ["unwraps cmd.exe wrappers", 'cmd.exe /d /s /c "dir"', "dir"],
    ["unwraps unquoted cmd.exe commands", "cmd.exe /c dir", "dir"],
    [
      "decodes doubled cmd.exe quotes",
      'cmd.exe /d /s /c "echo ""hello"""',
      'echo "hello"',
    ],
    [
      "decodes cmd.exe caret escaping",
      'cmd.exe /d /s /c "echo first ^& echo second"',
      "echo first & echo second",
    ],
    [
      "unwraps PowerShell wrappers",
      'powershell.exe -NoLogo -NoProfile -Command "Get-ChildItem"',
      "Get-ChildItem",
    ],
    [
      "unwraps unquoted PowerShell commands",
      "pwsh.exe -NoProfile -Command Get-ChildItem",
      "Get-ChildItem",
    ],
    [
      "decodes PowerShell backtick escapes",
      'pwsh.exe -NoProfile -Command "Write-Host `"hello`""',
      'Write-Host "hello"',
    ],
    [
      "decodes PowerShell doubled single quotes",
      "pwsh.exe -NoProfile -Command 'Write-Host ''hello'''",
      "Write-Host 'hello'",
    ],
  ])("%s", (_, input, expected) => {
    expect(normalizeCommandDisplayText(input)).toBe(expected);
  });

  it("handles many distinct real-world shell strings", () => {
    const inputs = [
      '/bin/bash -lc "cd /repo && bun run lint"',
      "/bin/bash -lc 'git status --short'",
      "/bin/bash -lc \"printf 'line1\\nline2'\"",
      'cmd.exe /d /s /c "echo ""ok"""',
      'pwsh.exe -NoProfile -Command "Write-Host `"done`""',
      "bun run test",
      "docker run --rm node:20 node -e \"console.log('noisy')\"",
    ];
    const expected = [
      "cd /repo && bun run lint",
      "git status --short",
      "printf 'line1\nline2'",
      'echo "ok"',
      'Write-Host "done"',
      "bun run test",
      "docker run --rm node:20 node -e \"console.log('noisy')\"",
    ];

    expect(inputs.map((value) => normalizeCommandDisplayText(value))).toEqual(
      expected,
    );
  });
});
