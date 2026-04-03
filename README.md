# jt-ide

This repository is a Bun + React TypeScript application that combines a backend-sidecar service and a web-based IDE interface for managing projects, worktrees, and Codex-powered coding sessions.

## Top-level files

- `.tasks/`
  - Procedural docs for day-to-day work, including commit rules and research/documentation standards used across the repo.
- `.gitignore`
  - Excludes generated artifacts, lock/build/runtime output, and environment-specific files from version control.
- `AGENTS.md`
  - Governs repository-specific agent instructions and the expected folder/file tree snapshot.
- `agent-todo.md`
  - Tracks completed/incomplete repository documentation and work tasks for local agent workflows.
- `biome.json`
  - Biome configuration for linting and formatting conventions.
- `bun-plugin-react-compiler.ts`
  - Bun plugin bridge used to support React compiler behavior in this project’s toolchain.
- `bun.lock`
  - Bun lockfile for deterministic dependency resolution.
- `bunfig.toml`
  - Bun runtime and script/config defaults.
- `package.json`
  - NPM/Bun manifest for scripts, dependencies, and package metadata.
- `stitch.zip`
  - Bundled artifact included in this repo, kept as a static distribution/runtime file.
- `tsconfig.json`
  - TypeScript compiler settings for the browser/backend shared codebase.

## Top-level folders

- `.tasks/`
  - Contributor operating procedures and documentation guidance.
- `docs/`
  - Internal design docs, audits, migration notes, and reference screenshots for UI behavior.
- `src/`
  - Application source for backend and frontend surfaces.
- `src/bun/`
  - Bun runtime/service procedures: RPC, project orchestration, persistence, file operations, and process control.
- `src/mainview/`
  - Browser application for the interactive IDE/workspace UI.

