# App Data schema migration invariants

This note maps the current App Data schema and startup migration behavior before moving DDL ownership out of `src/bun/db.ts`.

## Current ownership boundary

`migrateDatabase(db)` is the startup entry point for the main app database. Today it owns three different responsibilities that the future seam should keep distinct:

1. **App Data schema planning** — table/index creation, additive column repairs, rebuild ordering, schema-version skip checks, and legacy-shape repairs needed to keep existing installations readable.
2. **Domain store compatibility work** — domain-specific data moves such as Calendar local-operator rebuilds, Plugin ingress table repairs, singleton local settings, Project/Thread/Cron permission backfills, and Web Server share ownership removal.
3. **Runtime CRUD APIs** — record creation/list/update helpers for Projects, Threads, Cron jobs, Plugin ingress, notifications, settings, auth, and Web Server shares. These should not move into a schema-planning module.

A future App Data schema seam should expose a small operation such as `migrateAppDataSchema(database)` plus introspection helpers for tests. It should not absorb domain CRUD functions, request authorization, runtime launch logic, or Mainview DTO mapping.

## Startup migration ordering

The current ordering in `migrateDatabase` protects legacy installations and must be preserved until a replacement test fixture proves otherwise:

1. **Skip check first.** `canSkipAppSchemaMigration` returns early only when `schema_version.version` equals `LATEST_APP_SCHEMA_VERSION` (`6`) and required tables, required columns, required Plugin ingress indexes, nullable `project_worktrees.pinned_at`, and repaired Calendar foreign-key targets are all present.
2. **Auth tables before auth legacy copies.** Create singleton `auth_settings`, `auth_sessions`, `auth_recovery_codes`, and `auth_websocket_tickets`, then copy from legacy `user_auth_*` tables and drop those legacy tables.
3. **Terminal settings before domain tables.** Create/seed `terminal_settings` independently of Project/Thread/Cron tables.
4. **Projects before dependents.** Create `projects`, rebuild away `owner_user_id`, and ensure `deleted_at` before creating `project_worktrees`, `threads`, `cron_jobs`, and Web Server shares that reference Projects.
5. **Project worktrees before listing indexes.** Create `project_worktrees`, rebuild old NOT NULL `pinned_at` rows into nullable tracked subprojects, then create the pinned/listing index.
6. **Threads before messages and cron runs.** Create `threads`, add/backfill legacy access columns into `permissions` and `plugin_access_groups`, drop legacy access columns, then create `thread_messages` and thread indexes.
7. **Cron jobs before cron runs.** Create `cron_jobs`, add/backfill access columns, dedupe active titles, add the active-title unique index, then create `cron_job_runs`.
8. **Web shares before share sessions.** Create `web_server_shares` and indexes before `web_server_share_sessions`; then later rebuild old `owner_user_id` shapes after Plugin/Calendar/local-settings initialization.
9. **Plugin ingress and notification schemas before local settings/calendar.** Initialize Plugin ingress cursors/messages/routes/audit/link/rate-limit tables and plugin notification tables before singleton timezone settings and Calendar schema work.
10. **Calendar after core local tables.** `initCalendarSchema` creates Calendar tables/indexes, rebuilds multi-user Calendar shapes, repairs legacy foreign-key targets, clears legacy ntfy secrets, migrates external Calendar id conflicts into a global id space, seeds the id sequence, and ensures a default local Calendar.
11. **Write schema marker last.** `writeAppSchemaVersion` runs only after all startup DDL and repair work completes.

## Current App Data tables and indexes

Core tables created directly by `migrateDatabase`:

- `schema_version`
- `auth_settings`, `auth_sessions`, `auth_recovery_codes`, `auth_websocket_tickets`
- `terminal_settings`
- `projects`, `project_worktrees`
- `threads`, `thread_messages`
- `security_audit_events`, `client_log_events`
- `cron_jobs`, `cron_job_runs`
- `web_server_shares`, `web_server_share_sessions`

Domain schema delegates called from `migrateDatabase`:

- Plugin ingress: `plugin_ingress_cursors`, `plugin_ingress_external_bindings`, `plugin_ingress_link_codes`, `plugin_ingress_route_configs`, `plugin_ingress_messages`, `plugin_ingress_audit_events`, `plugin_ingress_rate_limit_markers`
- Plugin notifications: `app_notification_deliveries`, `plugin_notification_rate_limits`
- Singleton local settings: `app_settings`
- Calendar: `calendar_id_sequence`, `calendars`, `calendar_user_preferences`, `calendar_events`, `calendar_event_exdates`, `calendar_event_overrides`, `calendar_event_reminders`, `external_ics_calendars`, `external_ics_event_cache`, `calendar_notification_settings`, `calendar_reminder_deliveries`, `calendar_snoozes`

Indexes that are part of the startup contract include auth expiry/lookup indexes, Project/Thread/Cron listing indexes, Web Server share/session lookup indexes, Calendar public slug/event/delivery indexes, Plugin ingress lookup/retention indexes, and Plugin notification rate-limit indexes. The schema seam should treat these as first-class required objects, not incidental statements embedded in CRUD modules.

## Skip-check invariants

`canSkipAppSchemaMigration` deliberately checks more than the version marker because older releases sometimes wrote a current `schema_version` while missing tables, columns, indexes, or repaired foreign-key targets. The skip gate currently requires:

- `schema_version` row `id = 1` with the latest version.
- Required table presence for Calendar, Plugin ingress, Plugin notifications, Projects, Worktrees, Terminal settings, and local app settings.
- Required columns on `cron_jobs`, `threads`, `web_server_shares`, `project_worktrees`, `app_settings`, `app_notification_deliveries`, and Plugin ingress tables.
- `project_worktrees.pinned_at` must not be `NOT NULL`.
- Calendar reminder/cache foreign keys must not point at dropped `calendar_events_legacy` or `external_ics_calendars_legacy` tables.
- Required Plugin ingress indexes must exist.

The future seam should keep skip-check inputs declarative so adding a table, required column, or required index also updates the fast-path guard.

## Risky legacy database shapes

These shapes are already handled by tests and should become fixture names or migration-case tests when DDL moves:

- `user_settings` without runtime-setting columns: copy the first timezone into singleton `app_settings`, initialize default command timeout and embedding model, then drop `user_settings`.
- Multi-user `projects.owner_user_id`: rebuild Projects without owner references and preserve unique paths.
- Multi-user `app_notification_deliveries.user_id`: rebuild to a singleton local inbox and recreate `idx_app_notification_deliveries_inbox`.
- Multi-user `web_server_shares.owner_user_id`: rebuild Web Server shares without owner references and recreate share lookup indexes.
- NOT NULL `project_worktrees.pinned_at`: rebuild to allow tracked but unpinned subprojects.
- Legacy `user_auth_settings`, `user_auth_sessions`, `user_auth_recovery_codes`, and `user_auth_websocket_tickets`: copy into singleton auth tables, then drop legacy tables.
- Missing Calendar tables despite a current schema marker: rerun Calendar DDL and seed the default Calendar.
- Calendar foreign keys that still reference renamed/dropped `*_legacy` tables: rebuild reminder/cache tables and reset stale external Calendar fetch errors.
- Missing Plugin ingress tables or indexes despite a current schema marker: rerun Plugin ingress DDL and repair required lookup/retention indexes.
- Legacy per-thread/per-cron boolean access columns: backfill split permission strings/access groups, then drop the legacy columns.

## Suggested future seam

Recommended split:

- `src/bun/app-data-schema.ts` (or equivalent) owns the migration plan, version marker, required object inventory, table/column/index introspection, safe SQL identifier helpers, and startup ordering.
- Domain stores provide narrow schema fragments or migration callbacks only for domain-specific DDL and data repair. Examples: Calendar local-operator rebuild, Plugin ingress route/message tables, notification inbox, and auth secret tables.
- `db.ts` keeps app-database path resolution, singleton open/close, pragma application, file permission checks, and high-level persistence APIs until later domain-store extractions move them deliberately.

Validation surfaces to preserve:

- `src/bun/db.test.ts` migration tests covering legacy settings, ownerless Projects/notifications/Web shares, singleton auth tables, skip-check repair cases, access-column cleanup, and tracked Worktree rows.
- Domain tests that call `migrateDatabase` before exercising Project, Thread, Cron, Calendar, Plugin ingress, Auth, and Web Server share persistence.
- A future focused schema-plan test should assert the required object inventory matches the plan so `schema_version` cannot advance without skip-check coverage.
