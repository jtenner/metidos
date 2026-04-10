Implement the minimal admin tooling needed to support the git-native task graph described in `docs/2026-04-10-git-native-task-graph-spec.md`.

## Scope

- add a shared filesystem model for canonical task graph files
- implement `init_task_graph`
- implement `validate_task_graph`
- implement `normalize_task_graph`
- expose the admin tools through the Jolt host with runtime gating
- add tests and developer documentation

## Acceptance

- the Bun backend can initialize the canonical `.jolt/tasks/` layout
- the backend can validate a repository task graph and report structured findings
- the backend can normalize canonical files without changing task semantics
- host policy can allow or deny the admin tools cleanly
- automated tests cover success cases and failure cases
- docs describe expected usage and boundaries
