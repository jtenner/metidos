Multiple optimization documents already exist because this codebase has seen real pain around UI re-renders, SQLite contention, RPC payload volume, cron concurrency, and starvation under pressure.

## Signals

- agent-heavy flows still concentrate work into one Bun process
- many integration tests are comparatively slow, which can hide flakiness and capacity problems
- the audit also called out future-dated artifacts and time-sensitive behavior as something worth tightening when benchmarking cron and runtime paths

## Desired Outcome

Have repeatable measurements and production-like load coverage so performance decisions are driven by evidence, not by stale assumptions.