# Mainview Thread-Status Controller

## Summary

This page records the durable design and implementation shape for optimization slice `OPT03.1`, completed on 2026-04-11, which extracted Metidos's thread-status polling and selected-thread detail refresh logic out of `src/mainview/App.tsx` into a dedicated controller module.

Observed outcome: the repository now contains `src/mainview/app/use-thread-status-controller.ts`, and `src/mainview/app/README.md` documents it as the owner of the mainview shell's thread-status polling and selected-thread refresh orchestration.

Durable design conclusion: Metidos should keep this hot thread-status path behind a narrow, memoized null-render controller boundary instead of inlining it in `App.tsx`, while leaving pure decision helpers in `src/mainview/thread-status-refresh.ts` and deferring protocol or store redesign to later slices.

Related areas:
- [2026-04-11-opt01-baseline-benchmark](./2026-04-11-opt01-baseline-benchmark.md)
- optimization planning under `./optimization-execution-proposal.md` and `./raw/optimization-proposals.md`
- later controller extraction and refresh-dedupe work, including [mainview-project-worktree-git-history-controllers](./mainview-project-worktree-git-history-controllers.md), [mainview-derived-state-memo-cleanup](./mainview-derived-state-memo-cleanup.md), and [thread-status-refresh-dedupe](./thread-status-refresh-dedupe.md)

## Problem

Before `OPT03.1`, one of the mainview shell's highest-churn controller paths lived inline inside `src/mainview/App.tsx`.

Observed behavior from the source design record:
- thread-status polling runs on an interval while threads are active
- the controller reacts to document-visibility changes
- selected-thread summary changes can trigger full detail refreshes
- all of that logic previously lived inside the already-large `App.tsx` shell

Durable problem statement: this path is both hot and correctness-sensitive, so leaving it inline in the top-level shell increases rerender pressure and makes the mainview boundary harder to reason about.

## Current state before the slice

Observed prior state from the source document:
- `src/mainview/App.tsx` owned thread-status polling, visibility-triggered refreshes, selected-thread detail escalation, and related refs/callbacks inline.
- `src/mainview/thread-status-refresh.ts` already existed as a helper module, but the main controller boundary still lived in `App.tsx`.
- Unrelated top-level shell state such as chat input edits, modal state, settings panels, and other toggles could rerun the controller path whenever the parent rerendered.

Observed consequence: a plain organizational extraction would not have been enough if it still reran as part of the parent shell on unrelated state changes.

## Chosen design

Recommended and implemented design from the source:
- add `src/mainview/app/use-thread-status-controller.ts`
- export a memoized `ThreadStatusController` component that returns `null`
- pass only the narrow prop set needed for thread-status work
- keep pure poll-selection and selected-detail refresh decisions in `src/mainview/thread-status-refresh.ts`
- preserve the existing polling and selected-thread correctness behavior
- update `src/mainview/app/README.md` so the controller boundary is documented where mainview module ownership is described

Durable architectural rule: when a mainview path is controller-heavy, high-frequency, and logically separable, prefer isolating it behind a dedicated memoized controller component instead of merely moving the code into another hook called from `App.tsx`.

## Controller responsibilities

Observed implemented responsibility boundary for `ThreadStatusController`:
- choose which thread ids should be polled
- run the periodic `listThreadStatuses(...)` poll loop
- refresh once when the document becomes visible again
- decide when a selected-thread summary change requires a full detail refresh
- commit refreshed thread summaries and selected-thread detail back into the thread store
- keep selected-thread refs synchronized and discard previous empty threads when selection changes

The source explicitly treats this as a controller extraction, not a protocol redesign.

## Render-boundary rationale

The key durable performance lesson in the source is not just code organization; it is render-boundary isolation.

Observed design reasoning:
- a plain custom-hook extraction would improve file organization but would not create a new render boundary
- a memoized null-render controller can be skipped by React on unrelated parent rerenders when its narrow inputs are unchanged
- this isolates thread-status work from unrelated shell state such as chat composer edits, git-history modal state, settings-panel state, cron panel state, and other top-level toggles

Recommended inference from the source: future `App.tsx` cleanup slices should preserve this pattern for similarly hot control paths when a narrow prop surface can be defined cleanly.

## Pure helper boundary

Observed helper boundary retained in `src/mainview/thread-status-refresh.ts`:
- `listWorkingThreadIds(...)`
- `shouldRefreshSelectedThreadDetail(...)`

Durable rule: keep poll-selection and selected-detail escalation logic testable as pure helpers when possible, even after extracting the orchestration layer into a controller component.

## Validation and measured outcomes

Observed structural outcomes recorded in the source document:

| Metric in `src/mainview/App.tsx` | Before | After | Change |
| --- | ---: | ---: | ---: |
| lines | `6850` | `6682` | `-168` |
| `useEffect(` count | `46` | `43` | `-3` |
| `useCallback(` count | `115` | `114` | `-1` |
| `useRef(` count | `26` | `24` | `-2` |
| `useMemo(` count | `12` | `11` | `-1` |

Observed test and validation coverage preserved by the slice:
- `src/mainview/thread-status-refresh.test.ts` covers working-thread id extraction and selected-thread detail refresh decisions
- repository validation was run with `bun run format` and `bun run validate`

Interpretation: these numbers are structural evidence of controller isolation, not a claim of standalone benchmarked latency improvement.

## Explicit non-goals

The source document explicitly excluded these changes from `OPT03.1`:
- websocket or polling protocol changes
- more aggressive request dedupe beyond the existing in-flight guard
- selected-thread detail caching redesign
- thread-store redesign or a global state-library migration
- broad `App.tsx` decomposition outside the thread-status path

Durable scope rule: use this slice as the boundary marker between controller extraction work and later protocol/dedupe/state redesign work.

## Affected files

Observed file set from the completed slice:
- `src/mainview/App.tsx`
- `src/mainview/app/use-thread-status-controller.ts`
- `src/mainview/thread-status-refresh.ts`
- `src/mainview/thread-status-refresh.test.ts`
- `src/mainview/app/README.md`

## Durable takeaway

The enduring lesson from `OPT03.1` is that Metidos's mainview shell should isolate hot, correctness-sensitive controller paths behind memoized controller modules with narrow prop surfaces, while keeping pure refresh-decision logic separately testable. For thread-status work specifically, the repository should preserve the dedicated `use-thread-status-controller.ts` boundary rather than drifting that polling and selected-thread refresh logic back into `App.tsx`.
