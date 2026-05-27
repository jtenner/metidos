# Plugin replay testing

Plugin replay fixtures are repository-safe traces that exercise Plugin System v1 behavior without live app data, network access, or real secrets. They are intended to catch compatibility and safety regressions in host/runtime changes; they do not prove that a plugin is safe for production or that every live host dependency behaves identically.

## Fixture schema

Replay fixtures use `schema = metidos.plugin-replay/v1` in JSON form:

```json
{
  "schema": "metidos.plugin-replay/v1",
  "pluginRoot": "docs/examples/plugins/hello_tool",
  "expectedTools": ["hello_world"],
  "events": [
    {
      "kind": "tool.execute",
      "tool": "hello_world",
      "context": { "contextKind": "threadTool", "worktreePath": "/fixture" },
      "props": { "format": "text", "name": "Replay" },
      "hostCalls": [],
      "expect": {
        "result": {
          "type": "text",
          "text": "Hello, Replay! This response came from the copyable Hello Tool example plugin."
        }
      }
    }
  ]
}
```

The canonical event model is host-event oriented:

- lifecycle/startup registration events verify declared tools, providers, crons, settings, env, storage, and permissions;
- callback events cover tool execution, cron execution, provider refresh/execution, notification provider execution, and future plugin callbacks;
- host API events record deterministic requests and mocked responses for `metidos.fetch`, `metidos.fs`, settings/env, logging, providers, notifications, calendar/events/users, terminal, SQLite, and storage/GC APIs;
- failure events record crashes, timeouts, rejected permissions, malformed responses, stale registrations, and corrupted `.data` state as expected errors.

The initial harness in `src/bun/plugin/replay.ts` executes QuickJS TypeScript plugins and supports tool callbacks with deterministic `metidos.fs` host calls. Additional host APIs should follow the same event shape before being enabled in fixtures.

## Safety and normalization rules

Fixtures must be safe to commit:

- never store real tokens, authorization headers, cookies, personal user data, production prompts, or plugin-authored secret output;
- redact keys matching `authorization`, `token`, `secret`, `password`, or `api_key` to `[REDACTED]`;
- replace live paths, user IDs, timestamps, request IDs, and nondeterministic ordering with stable fixture values;
- prefer hand-authored fixtures for security-sensitive paths; captured fixtures require review before commit;
- network replay must use mocked responses only, not live endpoints.

## What replay proves

Replay proves that a recorded or authored plugin interaction still produces the same normalized result and host API call sequence under the current runtime. It is useful for CI compatibility checks and regression diffs.

Replay does not prove that a plugin is trustworthy, that live external services are healthy, that all user data is covered, or that host permissions are safe. Approval review, permission minimization, runtime isolation, and normal tests are still required.
