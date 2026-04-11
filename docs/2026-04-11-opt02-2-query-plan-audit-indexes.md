# 2026-04-11 OPT02.2 Query-Plan Audit and Missing Composite Indexes

**Status:** completed on 2026-04-11  
**Slice:** [OPT02.2](../agents-todo.md)  
**Primary planning references:**
- [docs/optimization-proposals.md](./optimization-proposals.md)
- [docs/2026-04-11-optimization-execution-proposal.md](./2026-04-11-optimization-execution-proposal.md)
- [docs/2026-04-11-opt01-3-baseline-benchmark.md](./2026-04-11-opt01-3-baseline-benchmark.md)
- [docs/2026-04-11-opt02-1-wal-mode-tuning.md](./2026-04-11-opt02-1-wal-mode-tuning.md)

## Summary

This slice completed the **measured query-plan work** that was intentionally deferred from `OPT02.1`.

The work stayed narrow:

- audit the hot read plans called out in the planning docs,
- add only the indexes that removed real temp-sort work,
- keep existing message-read indexes where they were already doing the job,
- avoid speculative extra indexes that were not justified by the audit.

The resulting changes were:

- add `idx_projects_last_opened_at_name` for project listing order,
- replace the old `idx_threads_updated_at` index with a new expression index that matches the real pinned-first thread ordering,
- rewrite `listThreads()` to use the equivalent `(pinned_at IS NULL)` ordering expression so SQLite can use that expression index,
- leave thread-message indexes unchanged because the audited message reads already used them.

## Why this slice stayed index-only

The earlier optimization docs discussed broader DB work, but the measured context from `OPT01` and `OPT02.1` still argued for restraint:

- `OPT01.3` showed **zero SQLite retries** in the representative harness run.
- `OPT02.1` already handled the low-risk runtime tuning step by enabling WAL mode.
- There was still no evidence for speculative read caches, generic query caching, or broad transaction rewrites.

That left one clear next move:

> check the actual SQLite query plans for the specific hot listing reads and only add the indexes that remove avoidable scan-and-sort behavior.

## Audit target set

Per the planning doc, this slice audited:

- `listProjects()`
- `listOpenProjects()`
- `listThreads()`
- selected thread-message reads:
  - `listThreadMessagesPage()`
  - thread activity lookup by `thread_id + item_id`

## Audit result before the change

On the pre-slice schema, the audited plans looked like this:

| Query | Pre-slice planner result |
|---|---|
| `listProjects()` | `SCAN projects` + `USE TEMP B-TREE FOR ORDER BY` |
| `listOpenProjects()` | `SCAN projects` + `USE TEMP B-TREE FOR ORDER BY` |
| `listThreads()` | `SCAN threads` + `USE TEMP B-TREE FOR ORDER BY` |
| `listThreadMessagesPage()` | `SEARCH thread_messages USING INDEX idx_thread_messages_thread_id (thread_id=?)` |
| activity lookup by `thread_id + item_id` | `SEARCH thread_messages USING COVERING INDEX idx_thread_messages_thread_item_id (thread_id=? AND item_id=?)` |

That meant:

- the **project** and **thread** listing reads were still paying for temp-sort work,
- the selected **message** reads were already aligned with existing indexes.

So the slice did **not** need “more indexes everywhere.” It needed exactly the indexes that remove the project/thread temp sorts.

## What changed

## 1. Added one shared project listing index

`src/bun/db.ts` now creates:

- `idx_projects_last_opened_at_name ON projects(last_opened_at DESC, name ASC)`

This one index was enough to support both:

- `listProjects()` ordering by `last_opened_at DESC, name ASC`
- `listOpenProjects()` filtering by `is_open = 1` while still reading in `last_opened_at DESC` order

### Why only one new project index was added

A stricter open-only index was considered during the audit, but it did not outperform the general recent-project ordering index consistently enough to justify another maintained index.

So this slice kept the project side to **one** new index.

## 2. Replaced the old thread recency index with an order-aligned expression index

Before this slice, the schema had:

- `idx_threads_updated_at ON threads(updated_at DESC, id DESC)`

That did **not** match the real `listThreads()` order, which is:

- pinned threads first,
- then pinned recency,
- then thread update recency,
- then creation/id tie-breaks.

This slice replaces that index with:

- `idx_threads_listing_order ON threads((pinned_at IS NULL), pinned_at DESC, updated_at DESC, created_at DESC, id DESC)`

This keeps the thread-index budget disciplined:

- do **not** keep the old index and add another one,
- instead, replace the less-relevant index with the one that matches the actual hot list query.

## 3. Aligned `listThreads()` with the expression index

`listThreads()` previously ordered by:

```sql
CASE WHEN pinned_at IS NULL THEN 1 ELSE 0 END ASC
```

This slice rewrote it to the equivalent:

```sql
(pinned_at IS NULL) ASC
```

That preserves the pinned-first semantics while letting SQLite match the expression index directly.

## 4. Left thread-message indexes alone

No new thread-message indexes were added.

That was intentional.

The audit showed that the selected message reads already used:

- `idx_thread_messages_thread_id`
- `idx_thread_messages_thread_item_id`

So this slice explicitly **did not** add extra descending or duplicate message indexes just because the slice title mentioned query-plan work.

## Query-plan result after the change

After the slice:

| Query | Post-slice planner result |
|---|---|
| `listProjects()` | `SCAN projects USING INDEX idx_projects_last_opened_at_name` |
| `listOpenProjects()` | `SCAN projects USING INDEX idx_projects_last_opened_at_name` |
| `listThreads()` | `SCAN threads USING INDEX idx_threads_listing_order` |
| `listThreadMessagesPage()` | `SEARCH thread_messages USING INDEX idx_thread_messages_thread_id (thread_id=?)` |
| activity lookup by `thread_id + item_id` | `SEARCH thread_messages USING COVERING INDEX idx_thread_messages_thread_item_id (thread_id=? AND item_id=?)` |

The important change is that the project/thread listing queries stop using temp b-trees for ordering.

## Focused performance validation

This slice included both:

- in-repo correctness tests, and
- a focused synthetic benchmark to quantify the planner change.

## In-repo correctness coverage

`src/bun/db.test.ts` now verifies that:

- project listing queries use `idx_projects_last_opened_at_name`,
- the thread listing query uses `idx_threads_listing_order`,
- the selected thread-message reads still use the existing message indexes,
- the pinned-first thread order is still semantically correct.

## Representative synthetic benchmark

A local benchmark was run against a seeded SQLite database with:

- **3000 projects**
- **120,000 threads**
- **960,000 thread-message rows**

The benchmark compared the pre-slice schema/query shape against the post-slice one.

### Read-path timing results

| Query | Pre-slice mean | Post-slice mean | Improvement |
|---|---:|---:|---:|
| `listProjects()` | `2.156 ms` | `1.636 ms` | `24.1%` faster |
| `listOpenProjects()` | `1.506 ms` | `1.164 ms` | `22.7%` faster |
| `listThreads()` | `220.893 ms` | `145.662 ms` | `34.1%` faster |
| `listThreadMessagesPage()` | `0.016 ms` | `0.013 ms` | effectively unchanged |

### Read-path p95 comparison

| Query | Pre-slice p95 | Post-slice p95 |
|---|---:|---:|
| `listProjects()` | `2.540 ms` | `1.971 ms` |
| `listOpenProjects()` | `1.737 ms` | `1.460 ms` |
| `listThreads()` | `246.247 ms` | `155.971 ms` |
| `listThreadMessagesPage()` | `0.030 ms` | `0.026 ms` |

### Interpretation

The benchmark says:

- the **thread list** was the clear win,
- the **project lists** also improved and now avoid temp sorts,
- the **message page read** was already fine, so adding more message indexes would have been unnecessary.

That is exactly the kind of “optimize only what the audit justified” outcome this slice was supposed to produce.

## Write-side tradeoff check

Because the thread listing index now keys on pinned state plus recency, it was important to also check write-side cost.

A separate synthetic write benchmark compared batches of **5000 `updated_at` updates** on a **20,000-thread** dataset:

| Schema | Mean batch time | p50 |
|---|---:|---:|
| pre-slice thread index (`idx_threads_updated_at`) | `9.406 ms` | `9.179 ms` |
| post-slice thread index (`idx_threads_listing_order`) | `10.791 ms` | `10.494 ms` |

That is a real write cost increase, but it is still a favorable trade in context:

- the slice did **not** keep both thread indexes,
- the read-side improvement for the hot global thread listing was much larger than the write penalty,
- the project index affects relatively infrequent project writes.

## Why no message-index change was the right call

The message-read audit is important because it prevented extra speculative work.

Both selected message reads were already index-backed before the slice:

- page reads by `thread_id` and descending `id`
- activity coalescing lookups by `thread_id + item_id`

The benchmark confirmed that those paths were already effectively free compared with the project/thread listing queries.

So the correct optimization move was:

- **keep the existing message indexes**,
- **do not add new ones just to make the slice look bigger**.

## Files changed by the slice

- [src/bun/db.ts](../src/bun/db.ts)
- [src/bun/db.test.ts](../src/bun/db.test.ts)
- [src/bun/README.md](../src/bun/README.md)

## Validation performed

Because this was a code slice, the usual repository validation was run:

- `bun run format`
- `bun run validate`

## What this slice explicitly did not do

To stay aligned with the measurement-led constraint, this slice did **not** add:

- query result caches
- extra message indexes
- speculative project partial indexes beyond the one benchmarked recent-project index
- transaction rewrites
- new SQLite pragmas
- schema changes outside the audited index set

## Completion note

This slice is complete.

It turns the planning document’s “query-plan audit and missing composite indexes” idea into a narrow, evidence-backed change set:

- audit the real plans,
- remove the project/thread temp sorts,
- preserve message-read restraint,
- document the read/write tradeoff clearly.

That leaves the next DB slice (`OPT02.3`) free to focus on retry metrics rather than reopening the index conversation without new evidence.
