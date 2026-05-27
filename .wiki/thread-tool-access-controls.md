# Thread Tool Access Controls

Summary: The repository’s durable thread access model is that the per-thread `permissions` array is the canonical source of truth for runtime tool visibility. Native tool-provider permissions use `metidos:*`; Plugin System v1 access permissions use `[plugin_id]:[access_id]`. This page preserves the 2026-04-07 access-control fix as a historical design note and documents the current Pi-native permission boundaries for web, GitHub, Git, agent-coordination, Metidos, Plugin System v1, and unsafe execution access. Status: observed historical fix with current Pi-native maintenance guidance.

## Problem

The original thread access controls drifted out of sync with the actual tool surface exposed to the agent runtime. A thread could present a restricted access configuration in the UI while still receiving additional tool families or only a partial subset of Metidos tools.

Observed failure modes from the 2026-04-07 incident:

- `Agents` off did not fully suppress planning and sub-agent tooling.
- `GitHub` off did not fully suppress GitHub connector tooling.
- `Metidos` on exposed only part of the Metidos tool surface.
- `Unsafe` was at risk of being conflated with tool-family visibility instead of sandbox policy.

Current maintenance concern: the tool surface has grown beyond those original toggles. Access documentation now needs to account for native `metidos:*` permission ids, plugin permission ids, and the fact that weather is plugin-provided rather than a native Metidos permission.

## Historical context

Observed: the original fix was implemented when Metidos still used the Codex client plus an MCP sidecar.

Observed: after the later Pi migration cleanup in RM15, the live equivalents moved to Pi-native tool packs in:

- `src/bun/pi/metidos/tools.ts`
- `src/bun/pi/github-tools.ts`
- `src/bun/pi/agents-tools.ts`

Inference: the old implementation details are superseded, but the access-boundary rules remain durable and should continue to constrain current runtime wiring.

## Durable access model

The intended steady-state model is:

| Permission id | Runtime responsibility |
| --- | --- |
| `metidos:web-search` | Current-information search and fetch tools, using provider-native search when available or Brave-backed `web_search` / `web_fetch` fallback |
| `metidos:webserver` | Project-scoped local static hosting through `web_server_host`, `web_server_stop`, and `web_server_list` |
| `metidos:github` | GitHub connector tool family only |
| `metidos:git` | Worktree-scoped local Git CLI helpers that do not require bash |
| `metidos:agents` | Pi-era planning and one-shot delegated helper tasks, currently `update_plan` and `delegate_task` |
| `metidos:sqlite` | Project-scoped `sqlite` tool for database files inside the current worktree |
| `metidos:lancedb` | Project-scoped LanceDB-style vector tools: `lancedb_upsert`, `lancedb_query`, and `lancedb_delete` |
| `metidos:calendar` | Calendar listing plus event lookup, creation, and modification tools; native agents do not create calendars |
| `metidos:notifications` | Local notification tools such as `notify_user`; sends through the local operator's configured notification channel |
| `metidos:threads` | Metidos thread-management tools such as `new_thread` |
| `metidos:crons` | Metidos cron tools such as `list_crons`, `show_cron`, `new_cron`, and `update_cron` |
| `metidos:unsafe` | Sandbox escalation, `bash`, unsafe child thread/cron requests, and the unsafe terminal policy when combined with required Metidos scopes |
| `[plugin_id]:[access_id]` | Thread-selected Plugin System v1 tools exposed as provider-safe `plugin_id_tool_name`; plugin access controls tool visibility, not host API permissions |

Recommended invariant: persisted thread permission arrays, generated runtime config, visible tool lists, and UI copy should all describe the same effective access surface. Legacy boolean columns and historical plugin access-group keys may remain in storage or compatibility parsing temporarily, but new runtime, docs, and agent-facing APIs should treat `permissions` as canonical.

Browser automation and screenshots are not native Metidos permissions. They appear only when an installed browser plugin declares an access descriptor and the thread selects that plugin permission, for example `chrome_browser:browser_tools`.

Weather is not a native Metidos permission. Weather tools appear only when an installed plugin declares a weather access descriptor and the thread selects that plugin permission, for example `weather:forecast`.

Prompt injection is a Plugin System v1 manifest capability (`metidos:prompt_inject`) and is activated per thread by enabling the plugin access group that declares `access[].injects[]`; it is not a native thread tool-family permission.

Tool names should use snake_case with a verb-first shape, usually `verb_noun` or `verb_noun_specifier`; `notify_user` is the canonical Notifications tool name.

## Root causes preserved from the incident

### Runtime config was not fully derived from thread flags

Observed in the historical implementation: thread state controlled only part of the runtime configuration, so the actual agent runtime could still expose broader tool families than the thread settings allowed.

Durable lesson: tool access must be projected into the runtime at configuration time, not inferred only from UI state or database records.

### Metidos tools were split across access domains

Observed in the historical implementation: some Metidos thread-management tools were gated by `agentsAccess` while other Metidos helpers were gated by `metidosAccess`.

Durable lesson: one product-facing tool family should have one controlling toggle. Splitting a family across toggles creates partial, confusing access states. When a family is deliberately split, as with current `Threads` and `Crons`, docs, UI labels, defaulting logic, runtime scopes, and tests should all use the split terms consistently.

### UI text diverged from runtime boundaries

Observed: access-control copy described boundaries that did not match the effective runtime behavior.

Durable lesson: when access semantics change, update both runtime wiring and user-facing labels in the same slice.

## Current Pi-native implications

Observed from the source note and current code: the runtime path depends on Pi-native wiring rather than the previous Codex/MCP sidecar arrangement.

Relevant current code paths:

- `src/bun/project-procedures.ts` — routes thread access semantics into the runtime path
- `src/bun/pi/thread-runtime.ts` — builds Pi sessions, system-prompt access summaries, built-in tool names, and per-family custom tool registration
- `src/bun/pi/metidos/tools.ts` — registers Metidos-native thread, cron, calendar, notification, and terminal tools behind the Metidos-family scopes
- `src/bun/pi/metidos/notifications.ts` — registers Notifications tools behind Notifications access
- `src/bun/pi/agents-tools.ts` — registers `update_plan` and `delegate_task` behind Agents access
- `src/bun/pi/github-tools.ts` — registers GitHub access tools
- `src/bun/pi/git-tools/index.ts` — registers local Git access tools
- `src/bun/pi/sqlite-tools.ts` — registers the project-scoped SQLite access tool
- `src/bun/pi/lancedb-tools.ts` — registers project-scoped LanceDB vector tools that use the configured Metidos embedding provider for query text
- `src/bun/pi/web-server/tools.ts` — registers WebServer access tools
- `src/bun/pi/plugin-tools.ts` — exposes selected Plugin System v1 tool access groups
- `src/mainview/controls/thread-access-control.tsx` — renders access toggle labels and hides any internal-only native permission ids
- `src/mainview/app/use-access-permissions.ts` and `src/mainview/app/thread-access-defaults.ts` — maintain permission-array defaults and compatibility normalization while callers migrate off legacy booleans
- `src/bun/pi/thread-runtime.test.ts`, `src/bun/pi/metidos/tools.test.ts`, `src/bun/pi/plugin-tools.test.ts`, and focused per-tool tests — verify runtime tool installation and access-gated behavior

Recommended maintenance rule: when changing thread permission boundaries, update runtime wiring, UI text, docs, and tests together.

## `update_thread` rule

Observed from the source note: `update_thread` is metadata-only inside a running thread.

Durable rule:

- allowed fields in-thread: `title`, `summary` / `description`, and `pinned`
- legacy compatibility access fields and current `permissions` inputs must not let a running thread change its own access policy

Why this matters: a thread must not be able to upgrade or downgrade its own sandbox or connector access by mutating thread metadata.

## Verification expectations

Recommended regression checks after access-control changes:

1. Create a thread with only `Threads` enabled and confirm thread helpers appear without cron helpers, GitHub tools, Git tools, or agent-coordination tools.
2. Create a thread with only `Crons` enabled and confirm cron helpers appear without thread-creation helpers.
3. Enable `Agents` and confirm only the Pi-era coordination tools appear.
4. Enable `GitHub`, `Git`, `SQLite`, `LanceDB`, and `WebServer` independently and confirm each family installs without requiring bash.
5. Enable `Unsafe` and confirm bash and unsafe child-request behavior appears, while disabling `Unsafe` removes it.
6. Select a Plugin System v1 permission such as `chrome_browser:browser_tools` and confirm only that access id's `plugin_id_tool_name` tools are installed.

Observed from current tests: runtime access coverage now lives mostly in `src/bun/pi/thread-runtime.test.ts`, `src/bun/pi/metidos/tools.test.ts`, and focused tool-family tests under `src/bun/pi/`.

## Risks

- Runtime config can silently drift from persisted thread flags.
- Pi-native tool packs can expose a broader surface than the UI implies.
- New Metidos helpers can accidentally land behind the wrong toggle.
- Plugin thread permissions can be mistaken for plugin host API permissions; they only control agent-visible tool exposure.
- UI copy can become stale and mislead manual verification.

## Open questions

- Whether this topic should later be merged into a broader wiki page for thread runtime access policy.
- Whether the repository should maintain an explicit matrix of every tool pack to access toggle mapping.

## Related pages

- [execution-boundary-hardening](./execution-boundary-hardening.md) — records the later 2026-04-12 closeout for safe defaults, safe-thread anti-escalation rules, the retired `run_untrusted_js` escape classes, and bounded unsafe child-operation budgets.

## Source

- Original source ingest: `docs/2026-04-07-thread-tool-access-controls.md` (removed after wiki ingestion on 2026-04-19)
- Related process doc: [`karpathy-llm-wiki-pattern`](./karpathy-llm-wiki-pattern.md)
