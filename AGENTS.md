# AGENTS

- Follow the repository commit process documented in `.tasks/commit.md`.
- Follow all style guidelines in `.tasks/style.md`.
- Always add generated files to `.gitignore` and keep them out of version control.
- New RPC features should include measurable telemetry hooks or counters where practical so performance-impacting additions can be observed in runtime stats instead of guessed at later.

- Current repository folder map:

  Only repo-owned folders are listed here. File names, dependency trees, VCS
  internals, and temporary/generated directories are intentionally omitted to
  keep the context small.

  - `.metidos/`
    Local Metidos task-graph data stored in the repository.
  - `.metidos/tasks/`
    Canonical task-graph config, tags, and task item directories.
  - `.metidos/tasks/items/`
    One directory per task item in the task graph.
  - `.tasks/`
    Repository-local process docs for commits, research, styling, and contributor workflow.
  - `docs/`
    Architecture notes, migration write-ups, and longer-form design research.
  - `src/`
    Application source root for backend and frontend code.
  - `src/bun/`
    Bun backend runtime, RPC server, persistence, Git integration, auth, cron, and Pi runtime wiring.
  - `src/bun/project-procedures/`
    Backend procedure helpers split by domain such as provider auth, history, telemetry, and shared utilities.
  - `src/mainview/`
    Browser application shell, RPC client wiring, auth shell, and top-level mainview entrypoints.
  - `src/mainview/app/`
    Main interface features and stateful UI modules for threads, projects, diffs, settings, and chat rendering.
  - `src/mainview/controls/`
    Reusable UI controls and selectors used across the mainview.
