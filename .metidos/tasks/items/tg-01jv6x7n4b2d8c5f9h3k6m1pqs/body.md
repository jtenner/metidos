Create the shared Bun-side model for reading and writing canonical task graph files.

## Notes

- likely home is `src/bun/project-procedures/`
- this layer should parse `config.toml`, optional registries, and per-task `task.toml` plus `body.md`
- keep the model aligned with the v2 spec instead of inventing an additional shape

## Acceptance

- canonical files can be loaded from `.metidos/tasks/`
- link sections are parsed as task IDs, not filesystem paths
- parser output is suitable for both validation and normalization work
- shared helpers make it hard for tool handlers to emit non-canonical files
