The audit noted that `.metidos/tasks/` is intentionally committed, while `AGENTS.md` currently says generated files should always be gitignored.

## Signals

- the task graph spec treats `.metidos/tasks/` as canonical repo-owned source of truth
- the repo guidance is currently easy to misread as applying to the canonical task graph as well

## Desired Outcome

Make the policy explicit so maintainers do not accidentally delete or ignore canonical task graph files while still keeping derived caches out of version control.