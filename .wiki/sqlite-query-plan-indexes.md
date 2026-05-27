# SQLite Query-Plan Audit and Composite Indexes

## Summary

This page captures the durable design and implementation outcome for optimization slice `OPT02.2`, completed on 2026-04-11. Metidos audited the actual SQLite query plans for the hot project and thread listing reads, then added only the indexes that removed real temp-sort work.

Observed outcome as of 2026-04-11:

- `src/bun/db.ts` adds `idx_projects_last_opened_at_name` on `projects(last_opened_at DESC, name ASC)`
- the older `idx_threads_updated_at` index is replaced by `idx_threads_listing_order` on `threads((pinned_at IS NULL), pinned_at DESC, updated_at DESC, created_at DESC, id DESC)`
- `listThreads()` now orders by `(pinned_at IS NULL) ASC` so SQLite can match the expression index directly
- message-read indexes remain unchanged because the audited message queries were already index-backed
- `src/bun/db.test.ts` verifies planner usage and pinned-first ordering behavior
- `src/bun/README.md` documents the measured, index-only scope of the slice

Related pages:

- [sqlite-wal-mode-tuning](./sqlite-wal-mode-tuning.md)
- [2026-04-11-opt01-baseline-benchmark](./2026-04-11-opt01-baseline-benchmark.md)
- [runtime-stats-collector](./runtime-stats-collector.md)
- [starvation-harness-reporting](./starvation-harness-reporting.md)

## Problem

After `OPT01` and `OPT02.1`, Metidos had a measured baseline and a low-risk SQLite runtime improvement, but some hot listing queries still paid avoidable sorting cost.

Observed pre-slice issue from the source:

- `listProjects()` and `listOpenProjects()` scanned `projects` and used a temporary b-tree for ordering
- `listThreads()` scanned `threads` and used a temporary b-tree for ordering
- selected thread-message reads were already using existing indexes correctly

Durable optimization question: should Metidos broaden SQLite work, or should it only remove the specific temp-sort work justified by real query-plan evidence?

## Current state before the slice

Observed from the source design record:

- `OPT01.3` showed zero SQLite retries in the representative benchmark run
- `OPT02.1` had already moved the runtime to WAL plus `synchronous = NORMAL`
- there was still no measured justification for speculative read caches, generic query caching, or broad transaction rewrites
- the planning docs called for auditing the real query plans of the hot list reads before adding indexes

Pre-slice planner results recorded by the source:

| Query | Pre-slice planner result |
|---|---|
| `listProjects()` | `SCAN projects` + `USE TEMP B-TREE FOR ORDER BY` |
| `listOpenProjects()` | `SCAN projects` + `USE TEMP B-TREE FOR ORDER BY` |
| `listThreads()` | `SCAN threads` + `USE TEMP B-TREE FOR ORDER BY` |
| `listThreadMessagesPage()` | `SEARCH thread_messages USING INDEX idx_thread_messages_thread_id (thread_id=?)` |
| activity lookup by `thread_id + item_id` | `SEARCH thread_messages USING COVERING INDEX idx_thread_messages_thread_item_id (thread_id=? AND item_id=?)` |

Durable implication: the justified next step was to remove the project/thread temp sorts while leaving the message side alone.

## Chosen design

Recommended and implemented outcome from the source:

1. add a single shared project-list ordering index:
   - `idx_projects_last_opened_at_name ON projects(last_opened_at DESC, name ASC)`
2. replace the less-relevant thread recency index with one that matches the actual hot list ordering:
   - `idx_threads_listing_order ON threads((pinned_at IS NULL), pinned_at DESC, updated_at DESC, created_at DESC, id DESC)`
3. rewrite `listThreads()` to use the equivalent order expression:
   - `(pinned_at IS NULL) ASC`
4. keep existing message indexes unchanged because the audited queries already use them:
   - `idx_thread_messages_thread_id`
   - `idx_thread_messages_thread_item_id`

This preserves the durable rule for the slice: optimize the measured hot ordering reads, not the entire database schema.

## Why the change stayed index-only

The source explicitly framed `OPT02.2` as the measured query-plan follow-up to `OPT02.1`, not as an excuse for broad database tuning.

Not adopted in this slice:

- query result caches
- extra descending or duplicate message indexes
- speculative open-only project partial indexes beyond the benchmarked shared index
- transaction rewrites
- new SQLite pragmas
- schema changes outside the audited index set

Durable rationale:

- the representative benchmark still showed no retry pressure that would justify broader concurrency work
- the hot cost was temp-sort work in specific list queries
- the message queries were already fast and index-backed
- each maintained index has write cost, so the index budget should stay disciplined

## Planner alignment details

### Project listings

The source chose one shared project index rather than multiple specialized variants:

- `listProjects()` orders by `last_opened_at DESC, name ASC`
- `listOpenProjects()` filters `is_open = 1` but still benefits from scanning in that same ordering

A stricter open-only index was considered, but the source concluded it did not justify another maintained index consistently enough to keep.

### Thread listing

Before the slice, Metidos kept:

- `idx_threads_updated_at ON threads(updated_at DESC, id DESC)`

That did not match the real global thread-list order, which is pinned-first and then ordered by pin recency and thread recency.

The replacement index captures the real sort shape:

- `(pinned_at IS NULL)`
- `pinned_at DESC`
- `updated_at DESC`
- `created_at DESC`
- `id DESC`

The source also rewrote `listThreads()` from:

- `CASE WHEN pinned_at IS NULL THEN 1 ELSE 0 END ASC`

to the equivalent:

- `(pinned_at IS NULL) ASC`

Observed rule: preserve the pinned-first semantics while making the query order directly match SQLite's expression-index support.

### Message reads

The source explicitly left message indexes alone.

Observed reason:

- page reads by `thread_id` were already using `idx_thread_messages_thread_id`
- activity lookups by `thread_id + item_id` were already using the covering `idx_thread_messages_thread_item_id`

Durable lesson: a query-plan slice should be allowed to conclude that some adjacent areas do not need change.

## Query-plan result after the slice

Post-slice planner results recorded by the source:

| Query | Post-slice planner result |
|---|---|
| `listProjects()` | `SCAN projects USING INDEX idx_projects_last_opened_at_name` |
| `listOpenProjects()` | `SCAN projects USING INDEX idx_projects_last_opened_at_name` |
| `listThreads()` | `SCAN threads USING INDEX idx_threads_listing_order` |
| `listThreadMessagesPage()` | `SEARCH thread_messages USING INDEX idx_thread_messages_thread_id (thread_id=?)` |
| activity lookup by `thread_id + item_id` | `SEARCH thread_messages USING COVERING INDEX idx_thread_messages_thread_item_id (thread_id=? AND item_id=?)` |

The durable performance change is straightforward: the hot project and thread listing queries stop using temporary b-trees for ordering.

## Validation and benchmark evidence

Observed validation recorded by the source:

- `bun run format`
- `bun run validate`

### Correctness coverage

The source says `src/bun/db.test.ts` verifies:

- planner usage for `idx_projects_last_opened_at_name`
- planner usage for `idx_threads_listing_order`
- continued use of the existing thread-message indexes
- semantic correctness of pinned-first thread ordering

### Representative synthetic read benchmark

A seeded SQLite benchmark compared pre-slice and post-slice behavior with:

- 3000 projects
- 120,000 threads
- 960,000 thread-message rows

Recorded mean results:

| Query | Pre-slice mean | Post-slice mean | Improvement |
|---|---:|---:|---:|
| `listProjects()` | `2.156 ms` | `1.636 ms` | `24.1%` faster |
| `listOpenProjects()` | `1.506 ms` | `1.164 ms` | `22.7%` faster |
| `listThreads()` | `220.893 ms` | `145.662 ms` | `34.1%` faster |
| `listThreadMessagesPage()` | `0.016 ms` | `0.013 ms` | effectively unchanged |

Recorded p95 results:

| Query | Pre-slice p95 | Post-slice p95 |
|---|---:|---:|
| `listProjects()` | `2.540 ms` | `1.971 ms` |
| `listOpenProjects()` | `1.737 ms` | `1.460 ms` |
| `listThreads()` | `246.247 ms` | `155.971 ms` |
| `listThreadMessagesPage()` | `0.030 ms` | `0.026 ms` |

Observed interpretation from the source:

- the global thread list was the clearest win
- project listings also improved by avoiding temp sorts
- message-page reads were already effectively free relative to the hot list queries

### Write-side tradeoff

The source also measured the write cost of the new thread listing index using batches of 5000 `updated_at` updates on a 20,000-thread dataset:

| Schema | Mean batch time | p50 |
|---|---:|---:|
| pre-slice `idx_threads_updated_at` | `9.406 ms` | `9.179 ms` |
| post-slice `idx_threads_listing_order` | `10.791 ms` | `10.494 ms` |

Durable interpretation:

- the new index does have a real write cost
- the slice avoids making that cost worse by replacing the old thread recency index rather than keeping both
- the read-side gain on the hot thread listing was large enough to justify the trade

## Affected repository areas

The source named these implementation surfaces:

- `src/bun/db.ts`
- `src/bun/db.test.ts`
- `src/bun/README.md`

## Durable takeaway

The durable lesson from `OPT02.2` is measured planner alignment: Metidos should inspect the real SQLite query plans for hot reads, add only the indexes that remove meaningful scan-and-sort work, align query expressions with those indexes when needed, and resist speculative extra indexes when adjacent reads are already effectively free.

## Source

Ingested from `docs/2026-04-11-opt02-2-query-plan-audit-indexes.md` on 2026-04-19, then removed from `docs/` after the durable knowledge was preserved in the wiki.
