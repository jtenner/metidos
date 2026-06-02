# Clean clone verification — 2026-06-02

This note records a local clean-clone smoke check for the public-readiness task: verify the repository can be cloned without relying on ignored local state from the current developer machine.

## Method

From the workspace root:

```bash
rm -rf .tmp/agent-clean-clone
mkdir -p .tmp
git clone --quiet "$(pwd)" .tmp/agent-clean-clone
cd .tmp/agent-clean-clone
git status --short
bun install --frozen-lockfile
bun run validate
```

The clone target is under ignored `.tmp/` so no generated dependency or build artifacts from the active worktree are copied by Git.

## Outcome

Initial check before the validation fix:

- `git status --short` in the clean clone printed no changes.
- `bun install --frozen-lockfile` completed successfully.
- `bun run validate` failed during `bun run test` because XML structured-data tests could not load the generated xmloxide WASM bundle from `native/xmloxide-wasm/dist/`.

Representative failure:

```text
MetidosXmlParseError: XML parsing requires the xmloxide WASM bundle or artifact. Run bun run native/xmloxide-wasm/build.ts. Missing /home/jtenner/Projects/jt-ide/.tmp/agent-clean-clone/native/xmloxide-wasm/dist/metidos_xmloxide_wasm.wasm; bundle load error: ResolveMessage: Cannot find module '../../../native/xmloxide-wasm/dist/metidos_xmloxide_wasm.cjs' from '/home/jtenner/Projects/jt-ide/.tmp/agent-clean-clone/src/bun/plugin/xml.ts'
```

Final test summary from the failed run:

```text
2373 pass
4 fail
45641 expect() calls
Ran 2377 tests across 286 files.
```

Follow-up check with the validation fix applied to the clean clone:

- `bun install --frozen-lockfile` completed successfully.
- `bun run validate` now runs `bun run build:xmloxide-wasm` before repository checks and tests.
- `bun run validate` completed successfully.

Final test summary from the passing run:

```text
2380 pass
0 fail
45665 expect() calls
Ran 2380 tests across 286 files.
```

## Decision

`bun run validate` now builds the ignored xmloxide WASM outputs before running tests. This keeps clean-clone validation self-contained from tracked files plus the documented native build toolchain, without committing generated `native/xmloxide-wasm/dist/` artifacts.
