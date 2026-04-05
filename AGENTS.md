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
├─ AGENTS.md
├─ biome.json
├─ bun-plugin-react-compiler.ts
├─ bun.lock
├─ bunfig.toml
├─ docs/
│  ├─ 2026-04-04-frontend-feedback-inventory.md
│  ├─ 2026-04-04-frontend-performance-inventory.md
│  └─ archive/
│     ├─ README.md
│     ├─ 2026-03-31-correctness-issues.md
│     ├─ 2026-03-31-correctness-issues-2.md
│     ├─ 2026-04-03-security-audit.md
│     ├─ 2026-04-03-security-audit-followup.md
│     ├─ 2026-04-03-security-remediation-plan.md
│     ├─ 2026-04-04-correctness-audit.md
│     ├─ 2026-04-04-correctness-audit-2.md
│     ├─ 2026-04-04-correctness-audit-current-tree.md
│     ├─ codex.md
│     ├─ codex-context-management.md
│     ├─ data-request-priority-audit.md
│     ├─ react-virtuoso-chat-migration.md
│     ├─ tanstack-virtual-chat-migration.md
│     └─ references/
│        ├─ README.md
│        ├─ ai_chat_mobile/
│        │  ├─ code.html
│        │  └─ screen.png
│        ├─ codex_view/
│        │  ├─ code.html
│        │  └─ screen.png
│        ├─ compact_diff_view_desktop/
│        │  ├─ code.html
│        │  └─ screen.png
│        ├─ compact_diff_view_mobile/
│        │  ├─ code.html
│        │  └─ screen.png
│        ├─ file_editor_mobile/
│        │  ├─ code.html
│        │  └─ screen.png
│        ├─ file_tree_view/
│        │  ├─ code.html
│        │  └─ screen.png
│        ├─ task_list_mobile/
│        │  ├─ code.html
│        │  └─ screen.png
│        └─ updated_tasks_view/
│           ├─ code.html
│           └─ screen.png
├─ package.json
├─ src/
│  ├─ README.md
│  ├─ bun/
│  │  ├─ README.md
│  │  ├─ auth-reset.test.ts
│  │  ├─ auth-reset.ts
│  │  ├─ auth-secrets.test.ts
│  │  ├─ auth-secrets.ts
│  │  ├─ auth-service.test.ts
│  │  ├─ auth-service.ts
│  │  ├─ auth.test.ts
│  │  ├─ auth.ts
│  │  ├─ build-mainview.ts
│  │  ├─ codex-sidecar-scope.test.ts
│  │  ├─ codex-sidecar-scope.ts
│  │  ├─ codex-sidecar-mcp.test.ts
│  │  ├─ codex-sidecar-mcp.ts
│  │  ├─ db.ts
│  │  ├─ db.test.ts
│  │  ├─ dev-flows.test.ts
│  │  ├─ dev-flows.ts
│  │  ├─ git.ts
│  │  ├─ git.test.ts
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
│  │  ├─ project-security-audit.test.ts
│  │  ├─ project-task-run.test.ts
│  │  ├─ project-security-audit.ts
│  │  ├─ rpc-authz.test.ts
│  │  ├─ rpc-authz.ts
│  │  ├─ rpc-schema.ts
│  │  ├─ sidecar-thread-metadata.test.ts
│  │  ├─ sidecar-thread-metadata.ts
│  │  ├─ rpc-websocket-auth.test.ts
│  │  ├─ rpc-websocket-auth.ts
│  │  ├─ security-audit-cli.test.ts
│  │  ├─ security-audit-cli.ts
│  │  ├─ security-audit.test.ts
│  │  ├─ security-audit.ts
│  │  ├─ server-security.test.ts
│  │  ├─ server-security.ts
│  │  ├─ static-server.ts
│  │  ├─ static-server-routing.test.ts
│  │  ├─ static-server-routing.ts
│  │  ├─ starvation-harness.ts
│  │  ├─ thread-metadata.test.ts
│  │  ├─ tls-config.test.ts
│  │  └─ tls-config.ts
│  └─ mainview/
│     ├─ README.md
│     ├─ App.tsx
│     ├─ auth-client.ts
│     ├─ auth-shell-connect.test.ts
│     ├─ auth-shell-connect.ts
│     ├─ auth-shell.tsx
│     ├─ project-close.test.ts
│     ├─ project-close.ts
│     ├─ project-lifecycle.test.ts
│     ├─ project-lifecycle.ts
│     ├─ project-worktree-refresh.test.ts
│     ├─ project-worktree-refresh.ts
│     ├─ rpc-errors.ts
│     ├─ startup-project-restore.test.ts
│     ├─ startup-project-restore.ts
│     ├─ startup-worktree-restore.test.ts
│     ├─ startup-worktree-restore.ts
│     ├─ thread-send.test.ts
│     ├─ thread-send.ts
│     ├─ thread-status-refresh.test.ts
│     ├─ thread-status-refresh.ts
│     ├─ app/
│     │  ├─ README.md
│     │  ├─ action-menus.tsx
│     │  ├─ auth-step-up-dialog.tsx
│     │  ├─ chat-workspace.tsx
│     │  ├─ chat-workspace.test.ts
│     │  ├─ desktop-sidebar.tsx
│     │  ├─ diff-parsing-client.ts
│     │  ├─ diff-parsing-worker.ts
│     │  ├─ diff-parsing.test.ts
│     │  ├─ diff-parsing.ts
│     │  ├─ diff-workspace.tsx
│     │  ├─ git-history-panel.tsx
│     │  ├─ invalidation-events.test.ts
│     │  ├─ invalidation-events.ts
│     │  ├─ message-markdown-loader.ts
│     │  ├─ message-markdown-routing.test.ts
│     │  ├─ message-markdown-routing.ts
│     │  ├─ message-markdown.tsx
│     │  ├─ message-preprocessing-client.ts
│     │  ├─ message-preprocessing-worker.ts
│     │  ├─ message-preprocessing.test.ts
│     │  ├─ message-preprocessing.ts
│     │  ├─ message-ui.tsx
│     │  ├─ projects-panel.tsx
│     │  ├─ projects-panel.test.ts
│     │  ├─ sidebar-content.tsx
│     │  ├─ sidebar-panels-state.ts
│     │  ├─ state.test.ts
│     │  ├─ state.ts
│     │  ├─ thread-list-row.tsx
│     │  ├─ threads-panel.tsx
│     │  ├─ use-add-project-form.ts
│     │  ├─ use-mainview-derived-state.ts
│     │  ├─ use-mainview-derived-state.test.ts
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
└─ tsconfig.json
```
