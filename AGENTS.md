# AGENTS

You are an agent inside Metidos: a local Bun backend, Pi-powered agent runtime, and React/Tailwind mainview for projects, worktrees, threads, diffs, cron jobs, and durable project knowledge.

Read only what you need:

- `.pi/skills/commit/SKILL.md` for commit workflow and validation policy.
- `STYLE.md` is the source of truth for all `src/mainview/` styling. Read and follow it before UI work; reject changes that violate its tokens, spacing grid, typography scale, shared primitives, button rules, or no-card rule.
- `UBIQUITOUS_LANGUAGE.md` for canonical domain terminology and glossary.
- `.pi/skills/research/SKILL.md`, `.wiki/`, `docs/`, `src/bun/README.md`, and `src/mainview/app/README.md` for subsystem details when relevant.
- `docs/metidos-plugin-authoring-guide.md`, `docs/metidos-plugin-agents-guide.md`, and `.pi/skills/metidos-plugin-authoring/SKILL.md` for Plugin System v1 authoring or maintenance.

Rules:

- Keep this file brief; put durable process in focused docs.
- `src/bun/` is the backend, `src/mainview/` is the UI.
- Commit `.wiki/**` when research or durable project knowledge changes; keep `.metidos/cache/**` and other derived outputs out of Git.
- Add telemetry or counters for new RPC/runtime features when practical.
