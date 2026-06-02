# Failing Test Diagnostics Verification (2026-06-02)

## Scope

Verify whether the repository's standard Bun test output gives outside contributors enough context to debug a failing test without needing private maintainer state.

This is a diagnostic-output smoke, not a product behavior test. The intentionally failing test file was created temporarily in the workspace and removed after the run.

## Environment

- Date: 2026-06-02
- Workspace: `/home/jtenner/Projects/jt-ide`
- OS/kernel: Linux `eefe0b53020d` `6.12.90+deb13.1-amd64` x86_64
- Bun version: `1.3.13`

## Command

```sh
cat > .tmp-failing-diagnostics.test.ts <<'EOF'
import { expect, test } from "bun:test";

test("diagnostic sample includes useful assertion context", () => {
  const observed = { status: 500, error: "missing setup", nextStep: "run setup" };
  expect(observed).toEqual({ status: 200, error: null, nextStep: "open app" });
});
EOF

bun test .tmp-failing-diagnostics.test.ts --timeout 10000
rm -f .tmp-failing-diagnostics.test.ts
```

## Result

Pass for the verification objective: the failing Bun test output included enough debugging context for an outside contributor.

The output included:

- the failing test file name,
- the test name,
- the exact assertion line with a caret marker,
- an object diff showing expected and received values,
- a stack location with file and line/column,
- pass/fail counts,
- assertion count, and
- elapsed runtime.

## Publication-safety note

Bun's stack location included the local absolute workspace path. That is useful while debugging locally, but contributors should redact private usernames, hostnames, and local paths before pasting logs into public issues or pull requests. The repository's public contribution templates already include this redaction expectation.

## Conclusion

No test-runner implementation change is needed for the current public-readiness slice. The default `bun test` failure format is contributor-debuggable for normal assertion failures, with the caveat that public log excerpts should redact local absolute paths.
