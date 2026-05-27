# Git Access Toolset

Summary: [Observed: stable] Repository now has a worktree-scoped local Git CLI tool family wired behind the `metidos:git` thread permission, allowing agents to run real Git workflows without unsafe bash. [Observed: recommended] Current implementation records per-tool telemetry for visibility.

Date: 2026-04-13
Status: implemented for most local Git operations; phased-in expansion already completed for the planned repository-first tool families.

## Problem

- [Observed] Safe threads intentionally do not have shell access (`metidos:unsafe` controls bash), which previously blocked local Git ergonomics when only structured tools were allowed.
- [Observed] Existing access controls separated GitHub connector capabilities from local repository tooling, so a dedicated local Git permission was needed.
- [Observed] Repository safety required this to remain worktree-bound and bounded, not a raw command passthrough.

## Current state (durable)

### Access model (observed)

Thread and cron access is now shaped by the canonical `permissions` array. Native tool-provider permissions use `metidos:*`; plugin access permissions use `[plugin_id]:[access_id]`.

`metidos:git` is the focus for this page. It remains separate from `metidos:github`, does not imply `metidos:unsafe`, and is inherited by safe child thread/cron defaults through the permission-array helpers.

### Runtime binding and prompt behavior (observed)

- `pi-thread-runtime.ts` installs local Git tools only when the thread has `metidos:git`.
- Safe runtime policy still keeps `allowBash: false` unless `metidos:unsafe` is enabled.
- Runtime prompt line now says local Git CLI helpers are installed when `metidos:git` is present, and explicitly states they do **not** require bash.

### Tool implementation shape (observed)

Local Git tools are implemented in a dedicated Pi-native module family:

- `src/bun/pi/git-tools/index.ts`
- `src/bun/pi/git-tools/shared.ts`
- per-family modules (`read.ts`, `search.ts`, `history-ops.ts`, `write.ts`, `history.ts`, `plumbing.ts`, `inspection.ts`, `low-level.ts`, `worktree.ts`) under `src/bun/pi/git-tools/`

The tools call through the shared `src/bun/git.ts` execution layer (`runGitCommand`, `runGitCommandResult`, history helpers, `normalizeGitPath`, and scheduler stats), preserving existing queueing, cancellation, and path-hardening logic.

Observed tool surface:

- **Read / history-inspection:** `git_status`, `git_diff`, `git_log`, `git_branch`, `git_show`, `git_stash_list`, `git_tag_list`, `git_notes_list`, `git_notes_show`
- **Write / mutation:** `git_add`, `git_restore`, `git_rm`, `git_mv`, `git_reset`, `git_revert`, `git_stash`, `git_tag`, `git_notes`, `git_commit`, `git_switch`
- **History operations:** `git_merge`, `git_rebase`, `git_cherry_pick`, `git_am`
- **Plumbing / refs:** `git_rev_parse`, `git_merge_base`, `git_range_diff`, `git_show_ref`, `git_shortlog`, `git_describe`, `git_check_ref_format`, `git_count_objects`
- **Search / blame / attribution:** `git_grep`, `git_blame`
- **Verification / low-level inspection:** `git_verify_commit`, `git_verify_tag`, `git_check_ignore`, `git_check_attr`, `git_ls_files`, `git_ls_tree`, `git_for_each_ref`, `git_cherry`, `git_show_branch`, `git_fsck`, `git_cat_file`
- **Worktree helpers:** `git_worktree_list`, `git_init`

### Safety and output discipline (observed)

- [Observed] Path-accepting arguments are normalized with worktree-aware helpers (`normalizeGitPathArgument*`), including quote normalization and deduplication.
- [Observed] Path operations reject traversal/symlink escapes in `src/bun/git.ts` via `normalizeGitPath` and `assertPathInsideWorktree`.
- [Observed] Git command spawn is argument-array based (`Bun.spawn([gitExecutable, ...args])`) with `-c core.hooksPath=/dev/null` and `GIT_TERMINAL_PROMPT=0`.
- [Observed] Tool schemas are typed by `TypeBox` and bounded by per-tool numeric/text limits.
- [Observed] Tool outputs are intentionally truncated/paginated via tool-specific `max*` parameters and metadata fields that include shown/total/truncated counts.
- [Observed] Cancellation is propagated via shared `AbortSignal` paths across command execution and tool calls.
- [Observed] Tool usage is wrapped with `runtime-stats.ts` counters (`recordGitToolStarted`, `recordGitToolSucceeded`, `recordGitToolFailed`) and exposed as `gitTools` in runtime snapshots.

## Design status against phase plan

The original plan in `docs/2026-04-13-git-access-toolset-game-plan.md` separated rollout into phases. The repository now includes Phase 1 and Phase 2 tool families end-to-end (and many adjacent low-level helpers):

1. **Phase 1 shell-replacement core** — completed in the current tool surface.
2. **Phase 2 repository introspection + plumbing reads** — completed for the listed inspection tools.
3. **Phase 3** and **Phase 4** (`clean`/advanced operations, remote operations like `fetch`/`push`) remain explicitly excluded from local Git surface.

## Recommended/ongoing rules (inferred and observed)

- `metidos:git` must remain separate from `metidos:github` and must not imply `metidos:unsafe`.
- Safe threads may use Git through this tool family without opening shell.
- Child threads and child cron jobs should preserve inherited `metidos:git` while still defaulting without `metidos:unsafe`.
- Telemetry should continue to be the source of evidence for expanding the phase-3/phase-4 set.

## Implementation evidence points

- `src/bun/pi/thread-runtime.ts`: tool-policy and system-prompt text for local Git tools.
- `src/bun/pi/git-tools/index.ts` + family modules: tool registration and host wiring.
- `src/bun/pi/git-tools/shared.ts`: path helpers, schema coercion helpers, and per-tool telemetry wrapper.
- `src/bun/git.ts`: command scheduler, path-bound normalization, shell-agnostic execution, cancellation, and hook/env hardening.
- `src/bun/runtime-stats.ts`: dedicated git tool metrics buckets.
- `src/mainview/controls/thread-access-control.tsx` and `src/mainview/app/thread-access-defaults.ts`: UI + inheritance behavior for `metidos:git`.

## Validation references

- `src/bun/pi/thread-runtime.test.ts`: verifies `metidos:git` causes local Git tools to appear in safe runtime tool sets.
- `src/bun/pi/git-tools/index.test.ts`: smoke/integration coverage across core Git tool calls and history/write operations.
- `src/bun/pi/git-tools/low-level.test.ts`: dedicated low-level verification coverage (`git_for_each_ref`, `git_cherry`, `git_fsck`, `git_cat_file`).
- `src/bun/pi/git-tools/inspection.test.ts`: path/ignore/blame/show-tag/etc coverage.
- `src/mainview/app/thread-access-defaults.test.ts` and `src/mainview/controls/thread-access-control.test.ts`: UI/defaulting coverage for access-control behavior.

## Risks / open questions

- **Open decision retained:** remote command support (`fetch`, `pull`, `push`, etc.) remains a separate policy decision, not implied by current toolset.
- **Open decision retained:** destructive or aggressive rewriting commands and stateful interactive flows (`clean`, `format-patch`, `archive`, etc.) are still deferred.
- [Observed] Because this is mostly tooling power, the practical risk is permission sprawl; keep the `metidos:git` matrix aligned with thread metadata, RPC config, and runtime prompt guarantees.

## Related pages

- [thread-tool-access-controls](./thread-tool-access-controls.md) — durable rule that tool-family visibility must follow thread access flags.
- [execution-boundary-hardening](./execution-boundary-hardening.md) — broader context on safe-vs-unsafe tool boundaries.
- [pi-coding-agent-migration](./pi-coding-agent-migration.md) — broader migration context for Pi-native tool packs.

## Source

- Source ingest: `docs/2026-04-13-git-access-toolset-game-plan.md` (removed after ingestion on 2026-04-19).
