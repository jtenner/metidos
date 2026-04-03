# AGENTS

- Follow the repository commit process documented in `.tasks/commit.md`.
- Always add generated files to `.gitignore` and keep them out of version control.

- Current repository file tree:

```text
.
├─ .tasks/
│  ├─ README.md
│  ├─ commit.md
│  └─ research.md
├─ .git
  ├─ .gitignore
  ├─ README.md
  ├─ AGENTS.md
  ├─ agent-todo.md
├─ biome.json
├─ bun-plugin-react-compiler.ts
├─ bun.lock
├─ bunfig.toml
├─ docs/
│  ├─ README.md
│  ├─ codex.md
│  ├─ 2026-03-31-correctness-issues.md
│  ├─ 2026-03-31-correctness-issues-2.md
│  ├─ codex-context-management.md
│  ├─ data-request-priority-audit.md
│  ├─ react-virtuoso-chat-migration.md
│  ├─ tanstack-virtual-chat-migration.md
│  └─ references/
    │     ├─ README.md
    │     ├─ ai_chat_mobile/
│     │  ├─ code.html
│     │  └─ screen.png
│     ├─ codex_view/
│     │  ├─ code.html
│     │  └─ screen.png
│     ├─ compact_diff_view_desktop/
│     │  ├─ code.html
│     │  └─ screen.png
│     ├─ compact_diff_view_mobile/
│     │  ├─ code.html
│     │  └─ screen.png
│     ├─ file_editor_mobile/
│     │  ├─ code.html
│     │  └─ screen.png
│     ├─ file_tree_view/
│     │  ├─ code.html
│     │  └─ screen.png
│     ├─ task_list_mobile/
│     │  ├─ code.html
│     │  └─ screen.png
│     └─ updated_tasks_view/
│        ├─ code.html
│        └─ screen.png
├─ package.json
├─ src/
│  ├─ README.md
│  ├─ bun/
│  │  ├─ README.md
│  │  ├─ build-mainview.ts
│  │  ├─ codex-sidecar-mcp.ts
│  │  ├─ db.ts
│  │  ├─ git.ts
│  │  ├─ index.ts
│  │  ├─ isolated-server.ts
│  │  ├─ project-procedures/
│  │  │  ├─ README.md
│  │  │  ├─ codex-catalog.ts
│  │  │  ├─ directory-suggestions.ts
│  │  │  ├─ git-history.ts
│  │  │  ├─ project-tasks.ts
│  │  │  ├─ shared.ts
│  │  │  └─ thread-detail.ts
│  │  ├─ project-procedures.ts
│  │  ├─ rpc-schema.ts
│  │  ├─ static-server.ts
│  │  └─ starvation-harness.ts
│  └─ mainview/
│     ├─ README.md
│     ├─ App.tsx
│     ├─ app/
│     │  ├─ README.md
│     │  ├─ action-menus.tsx
│     │  ├─ chat-workspace.tsx
│     │  ├─ desktop-sidebar.tsx
│     │  ├─ diff-workspace.tsx
│     │  ├─ git-history-panel.tsx
│     │  ├─ message-ui.tsx
│     │  ├─ projects-panel.tsx
│     │  ├─ sidebar-content.tsx
│     │  ├─ sidebar-panels-state.ts
│     │  ├─ state.ts
│     │  ├─ tasks-workspace.tsx
│     │  ├─ thread-list-row.tsx
│     │  ├─ threads-panel.tsx
│     │  ├─ use-add-project-form.ts
│     │  ├─ use-mainview-derived-state.ts
│     │  ├─ use-thread-previews.ts
│     │  ├─ use-worktree-diff.ts
│     │  └─ workspace-panel.tsx
│     ├─ controls/
│     │  ├─ README.md
│     │  ├─ chat-composer-control.tsx
│     │  ├─ codex-model-selector.tsx
│     │  ├─ codex-utils.ts
│     │  ├─ dropdown.tsx
│     │  ├─ icons.tsx
│     │  ├─ project-task-selector.tsx
│     │  ├─ reasoning-effort-selector.tsx
│     │  ├─ search-utils.ts
│     │  ├─ sidebar-search-control.tsx
│     │  └─ sidebar-section-header.tsx
│     ├─ index.css
│     ├─ index.html
│     ├─ index.ts
│     └─ input.css
├─ tsconfig.json
└─ stitch.zip
```
