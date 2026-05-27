# RPC schema domain modules

`src/bun/rpc-schema.ts` is the aggregate RPC contract entrypoint imported by backend and Mainview callers. Domain files in this directory own focused groups of request/response payload shapes while the aggregate preserves the stable compatibility surface.

## Adding or moving RPC shapes

- Place new domain-owned payload types in the nearest domain module, such as `plugin.ts` or `project-worktree.ts`.
- Re-export every public domain type or value from `../rpc-schema.ts` so existing aggregate imports keep working.
- Keep `AppRPCSchema` and `ProjectProcedures` in `../rpc-schema.ts`; they compose domain payloads into the full client-callable contract.
- Update `../rpc-schema.contract.test.ts` when a domain module exports a new public type or value. The test intentionally fails typecheck if a domain export drifts from the aggregate re-export.
- Add a new domain module when a contract group becomes large enough to need local ownership, then document the module here and in `src/bun/README.md`.

## Current modules

- `app-bootstrap.ts` owns Mainview HTML bootstrap policy, bootstrap hint, pinned worktree, and app bootstrap result payload shapes.
- `cron.ts` owns cron job status and cron job payload shapes.
- `model-catalog.ts` owns model option, reasoning effort, and model catalog payload shapes.
- `notifications.ts` owns user notification delivery, provider receipt, and delivery result payload shapes.
- `plugin.ts` owns Plugin System v1 inventory, settings, ingress, lifecycle, diagnostics, and thread-permission payload shapes.
- `project-worktree.ts` owns project, worktree, filesystem snapshot, and git-history payload shapes.
- `settings.ts` owns timezone and runtime settings payload shapes.
- `terminal.ts` owns terminal session, settings, creation request, and connection payload shapes.
- `thread.ts` owns thread start, status, usage, compaction, message, attachment, and detail payload shapes.
- `thread-extension-ui.ts` owns thread extension UI request/response payload shapes.
