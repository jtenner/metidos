# Glossary

This is the public documentation glossary. `../UBIQUITOUS_LANGUAGE.md` remains the deeper source of truth for internal domain terminology.

## Core product terms

**Metidos** — the local IDE application that coordinates projects, worktrees, agent threads, tools, plugins, tasks, calendars, notifications, and runtime diagnostics.

**Local Operator** — the single authenticated person using one local Metidos installation.

**App Data** — the local data root for one installation. It stores SQLite databases, Pi runtime state, plugin installations, plugin data, auth secrets, settings, and telemetry sidecars.

**Mainview** — the browser-first React/Tailwind UI.

**Backend** — the Bun server layer that hosts HTTP routes, RPC handlers, persistence, Pi orchestration, plugins, cron execution, and share workers.

**RPC** — the typed WebSocket request/response contract between Mainview and Backend.

## Work context

**Project** — a high-level entry point for one or more Git worktrees.

**Worktree** — a Git checkout context that can be opened, selected, and used as the root for Thread tools.

**Workspace Path Scope** — the Backend-owned policy object that normalizes, formats, and restricts project and worktree paths.

**Directory Suggestion** — a Backend-produced folder option for path inputs. It helps UX but does not itself authorize access.

## Threads and runtime

**Thread** — a Pi-powered agent execution session attached to a selected Project and Worktree context.

**Message** — a single persisted communication item within a Thread.

**Turn** — one complete agent response cycle inside a Thread.

**Run Status** — the current execution state of a Thread turn, such as queued, working, stopped, completed, or failed.

**Agent** — the Pi-powered coding runtime that executes Thread turns and invokes tools.

**Pi Runtime** — the Metidos adapter around Pi sessions, provider resolution, tool installation, extension UI, and persisted Thread session files.

**Access Control** — the per-Thread or per-Cron toggle set that determines which tool families, plugin access groups, and sandbox policies are active.

**Safe Mode** — the default Thread posture where bash and unsafe child-thread or cron escalation are unavailable.

**Unsafe Mode** — an explicit access-control state that enables bash and unsafe child-thread or cron requests.

## Diffs and Git

**Diff** — a file content comparison shown in the worktree view, message history, or Git history.

**Git Tools** — worktree-scoped local Git tools exposed without requiring bash.

**GitHub Tools** — worktree-bound GitHub CLI tools for repository, issue, pull request, CI, and diff inspection.

## Providers and models

**Provider** — a model service family exposed through Pi, such as OpenAI, Anthropic, OpenRouter, Ollama, or a plugin provider.

**Built-in Provider** — a provider implemented by Pi and configured by Metidos through environment variables, plugin settings, or Pi Auth handoff.

**Plugin-backed Provider** — a provider registered at runtime by an approved Plugin System v1 sidecar.

**Model** — a specific AI model identifier offered by a Provider.

**Model Catalog** — the UI-visible set of provider-qualified model options.

**Provider-qualified Model ID** — the stable model selection key that includes provider identity.

**Embedding Provider** — a provider configuration that can return vector embeddings for text.

## Plugins

**Plugin System v1** — the local-operator-approved extension system that discovers plugin folders, reviews manifests and hashes, and runs approved code in sidecars.

**Plugin** — a local extension folder under App Data that contains `metidos-plugin.json`, `AGENTS.md`, and a manifest-declared entrypoint.

**Core Plugin** — a first-party plugin source folder under `core_plugins/` that Metidos syncs into App Data on startup.

**Manifest** — the `metidos-plugin.json` review contract declaring plugin identity, permissions, settings, access groups, providers, ingress sources, notifications, and limits.

**Review Hash** — the deterministic hash of plugin source and seed files that the Local Operator approves before activation.

**Approval** — the Local Operator's decision that allows the current plugin review hash to run.

**Activation** — runtime loading of an approved plugin into its sidecar.

**Access Group** — a plugin-declared Thread-visible group that controls which plugin tools are offered to a Thread.

**Permission** — a manifest-declared host capability such as network, filesystem, provider registration, or notification provider access.

**Plugin Settings** — the single per-plugin map of manifest-declared configuration values stored in App Data.

**Plugin Data** — plugin-owned `.data/` addressed through `~/` by plugin filesystem APIs.

**Plugin Lifecycle Status** — the review/runtime state label for a plugin, such as Uninitialized, Needs Review, Active, Failed/Degraded, Disabled/Restart Required, or Missing/Unavailable.

## Cron and scheduling

**Cron Job** — a recurring scheduled agent session tied to a Project and Worktree.

**Cron Scheduler** — the sidecar worker that keeps schedule registrations in sync with Cron rows.

**Cron Runner** — the executor that turns a due Cron fire into a child Thread and tracks run state.

**Plugin Cron** — a plugin-registered global scheduled callback without current Thread or Project context.

## Auth and security

**Local Auth** — the local setup and sign-in system that protects browser access to one Metidos installation.

**Primary Factor** — the configured PIN, password, or passphrase used for local sign-in and step-up checks.

**TOTP Enrollment** — the local time-based one-time-password setup used as the second factor.

**Recovery Code** — a locally generated backup code that can recover access when normal TOTP use is unavailable.

**Session** — the authenticated browser/login session used to authorize HTTP and RPC access.

**Step-up Authentication** — a recent primary-factor plus TOTP proof required before plugin actions that approve or run code.

**WebSocket Ticket** — a short-lived auth credential issued before the browser opens `/rpc`.

## Diagnostics and data ownership

**Runtime Stats** — resettable in-memory counters and summaries for RPC, websocket, SQLite, cron, tool, cache, and budget behavior.

**Telemetry Sidecar** — optional local SQLite sink for periodic runtime-diagnostics snapshots.

**Security Audit Event** — a persisted record for privileged or sensitive local actions.

**Canonical** — repo-owned source-of-truth data that is version controlled.

**Derived** — generated, cached, or runtime output that is not version controlled.
