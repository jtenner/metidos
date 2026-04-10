Add test coverage for repository bootstrap, validation, normalization, and host exposure.

## Scope

- fixture repositories for valid and invalid task graphs
- validation assertions for missing files, bad IDs, and unresolved blockers
- normalization assertions for key ordering and stable no-op rewrites
- host-level tests for admin tool gating and response shapes

## Acceptance

- tests fail when canonical ordering changes unexpectedly
- tests cover both allowed and denied admin-tool execution
- fixture coverage is strong enough to keep the spec and implementation aligned
