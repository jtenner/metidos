Implement canonical normalization for task graph files without changing task meaning.

## Scope

- enforce stable key ordering in `task.toml`
- sort and deduplicate link arrays and tag arrays
- normalize formatting without inventing missing semantics
- avoid rewriting files when the canonical output is unchanged

## Acceptance

- repeated normalization produces no diff after the first clean pass
- normalization does not drop unknown-but-valid data
- unrelated task files are not rewritten unnecessarily
