# Performance validation

Use this workflow when a change may affect Backend responsiveness, RPC payload size, SQLite contention, Git/worktree operations, cron launch pressure, thread startup, or bounded Metidos tool budgets.

## Standard local checks

Start from a clean or isolated App Data directory so results are not tied to private local state:

```bash
bun run tailwind:build

APP_DATA_DIR="$(mktemp -d -t metidos-perf-XXXXXX)"

METIDOS_APP_DATA_DIR="$APP_DATA_DIR" \
METIDOS_DEV=1 \
METIDOS_DEV_RESET=1 \
bun run src/bun/index.ts --dev --port 7611 --track-telemetry
```

Then run the broad runtime harness from another shell:

```bash
bun run harness:starvation \
  --port 7611 \
  --project-path <path-to-a-safe-local-test-project> \
  --workers 3 \
  --warmup-ms 300 \
  --duration-ms 3000 \
  --json
```

For changes to child-thread or cron tool budgets, also run:

```bash
bun run benchmark:metidos-tools --json
```

## How to interpret results

- Treat `pressure.failedCount` as unexpected loop failures that need investigation.
- Treat `pressure.preemptedCount` as expected Git scheduler backpressure unless the count changes dramatically or appears with user-visible failures.
- Compare JSON summaries against previous local baselines instead of relying on subjective UI feel.
- Keep telemetry and harness output local unless it has been reviewed for paths, model names, prompts, and other sensitive data.

## What not to publish

Do not commit telemetry sidecar databases, raw benchmark logs with private paths, thread transcripts, provider responses, local database files, screenshots of real projects, or unredacted diagnostics.

Use fake or disposable projects when producing public performance evidence.
