# Clean-clone `bun run validate` smoke — 2026-06-03

This note records the public-readiness validation smoke for `bun run validate` from a disposable checkout.

## Environment

- Host OS: Linux container workspace at `/home/jtenner/Projects/jt-ide`
- Disposable checkout root: `.metidos/cache/validate-clean-clone-fix-2026-06-03/checkout` (gitignored)
- Bun version: `1.3.13`
- Command under test: `bun run validate`

## Initial finding

A clean clone of the current `HEAD` installed dependencies successfully but failed during `bun run typecheck`:

```bash
rm -rf .metidos/cache/validate-clean-clone-smoke-2026-06-03
mkdir -p .metidos/cache/validate-clean-clone-smoke-2026-06-03
git clone --local . .metidos/cache/validate-clean-clone-smoke-2026-06-03/checkout
cd .metidos/cache/validate-clean-clone-smoke-2026-06-03/checkout
git status --short
bun --version
bun install --frozen-lockfile
bun run validate
```

Result before the fix: `bun run validate` exited with code `2` because `src/bun/message-activity-store.test.ts` passed `number | undefined` values into expectations and pagination options that require definite `number` or `number | null` values.

## Fix

`src/bun/message-activity-store.test.ts` now narrows the first captured activity id before asserting the cursor and converts an absent cursor to `null` before reading the next page. This keeps the test's runtime expectations unchanged while satisfying TypeScript's stricter indexed-access types.

## Post-fix verification

The fixed validation path was verified from a disposable clean clone with the patch applied:

```bash
rm -rf .metidos/cache/validate-clean-clone-fix-2026-06-03
mkdir -p .metidos/cache/validate-clean-clone-fix-2026-06-03
git clone --local . .metidos/cache/validate-clean-clone-fix-2026-06-03/checkout
git diff -- src/bun/message-activity-store.test.ts > .metidos/cache/validate-clean-clone-fix-2026-06-03/message-activity.patch
cd .metidos/cache/validate-clean-clone-fix-2026-06-03/checkout
git apply ../message-activity.patch
bun install --frozen-lockfile
bun run validate
```

Clean-clone result after the fix:

- `git status --short`: empty before applying the verification patch
- `bun install --frozen-lockfile`: passed
- `bun run validate`: passed
- Test summary: `2596 pass`, `0 fail`, `46766 expect() calls`, across `310 files`

A validation run in the active working checkout was also attempted after formatting the touched test file. It failed on a pre-existing unstaged `src/mainview/app/cronjob-workspace.tsx` accessibility lint error that was outside this slice. The disposable clean-clone verification above isolates this validation fix from those unrelated working-tree edits.
