Implement repository bootstrap logic for the canonical task graph layout.

## Scope

- create `.jolt/tasks/` when missing
- write a default `config.toml`
- optionally seed empty registries only when requested by the caller
- avoid clobbering existing canonical files

## Acceptance

- running the initializer in an empty repo creates the expected layout
- rerunning the initializer is idempotent
- the implementation reports what it created versus what already existed
