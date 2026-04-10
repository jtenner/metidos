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
├─ agents-todo.md
├─ biome.json
├─ bun-plugin-react-compiler.ts
├─ bun.lock
├─ bunfig.toml
├─ docs/
│  ├─ 2026-04-07-thread-tool-access-controls.md
│  ├─ 2026-04-09-codex-via-pi-wiring.md
│  └─ 2026-04-09-pi-coding-agent-migration-research.md
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
│  │  ├─ pi-agents-tools.test.ts
│  │  ├─ pi-agents-tools.ts
│  │  ├─ pi-codex-auth.test.ts
│  │  ├─ pi-codex-auth.ts
│  │  ├─ logging.test.ts
│  │  ├─ logging-thread.ts
│  │  ├─ logging.ts
│  │  ├─ db.ts
│  │  ├─ db.test.ts
│  │  ├─ dev-flows.test.ts
│  │  ├─ dev-flows.ts
│  │  ├─ git.ts
│  │  ├─ git.test.ts
│  │  ├─ index.ts
│  │  ├─ pi-github-tools.test.ts
│  │  ├─ pi-github-tools.ts
│  │  ├─ pi-extension-ui.test.ts
│  │  ├─ pi-extension-ui.ts
│  │  ├─ pi-rpc-probe-extension.ts
│  │  ├─ pi-jolt-tools.test.ts
│  │  ├─ pi-jolt-tools.ts
│  │  ├─ pi-runtime-probe.test.ts
│  │  ├─ pi-runtime-probe.ts
│  │  ├─ pi-thread-runtime-integration.test.ts
│  │  ├─ pi-thread-runtime.test.ts
│  │  ├─ pi-thread-runtime.ts
│  │  ├─ project-procedures/
│  │  │  ├─ README.md
│  │  │  ├─ command-normalization.test.ts
│  │  │  ├─ command-normalization.ts
│  │  │  ├─ model-catalog.ts
│  │  │  ├─ directory-suggestions.ts
│  │  │  ├─ git-history.ts
│  │  │  ├─ pi-event-projection.test.ts
│  │  │  ├─ pi-event-projection.ts
│  │  │  ├─ pi-session-telemetry.test.ts
│  │  │  ├─ pi-session-telemetry.ts
│  │  │  ├─ shared.ts
│  │  │  └─ thread-detail.ts
│  │  ├─ project-procedures.ts
│  │  ├─ project-procedures-config.test.ts
│  │  ├─ project-security-audit.test.ts
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
│  │  ├─ vm2-runner-bun.test.ts
│  │  ├─ vm2-runner-console.test.ts
│  │  ├─ vm2-runner-test-utils.ts
│  │  ├─ vm2-runner-timeout.test.ts
│  │  ├─ vm2-runner-worker.ts
│  │  ├─ vm2-runner-worktree.test.ts
│  │  ├─ vm2-runner.ts
│  │  ├─ starvation-harness.ts
│  │  ├─ thread-tool-scope.test.ts
│  │  ├─ thread-tool-scope.ts
│  │  ├─ thread-metadata.test.ts
│  │  ├─ tls-config.test.ts
│  │  ├─ tls-config.ts
│  │  ├─ sidecar-cron-runner.test.ts
│  │  ├─ sidecar-cron-runner.ts
│  │  ├─ sidecar-cron-scheduler.ts
│  │  └─ sidecar-cron-thread.ts
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
│     ├─ thread-workspace-selection.test.ts
│     ├─ thread-workspace-selection.ts
│     ├─ thread-send.test.ts
│     ├─ thread-send.ts
│     ├─ thread-status-refresh.test.ts
│     ├─ thread-status-refresh.ts
│     ├─ thread-extension-ui.test.ts
│     ├─ thread-extension-ui.ts
│     ├─ app/
│     │  ├─ README.md
│     │  ├─ action-menus.tsx
│     │  ├─ auth-step-up-dialog.tsx
│     │  ├─ desktop-sidebar-content.tsx
│     │  ├─ desktop-thread-switcher.test.ts
│     │  ├─ desktop-thread-switcher.tsx
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
│     │  ├─ pinned-threads-panel.tsx
│     │  ├─ projects-panel.tsx
│     │  ├─ projects-panel.test.ts
│     │  ├─ settings-panel.tsx
│     │  ├─ sidebar-content.tsx
│     │  ├─ sidebar-panels-state.ts
│     │  ├─ state.test.ts
│     │  ├─ state.ts
│     │  ├─ thread-extension-ui-dialog.tsx
│     │  ├─ thread-list-row.tsx
│     │  ├─ threads-panel.tsx
│     │  ├─ use-add-project-form.ts
│     │  ├─ use-mainview-derived-state.ts
│     │  ├─ use-mainview-derived-state.test.ts
│     │  ├─ use-thread-previews.test.ts
│     │  ├─ use-thread-previews.ts
│     │  ├─ use-worktree-diff.ts
│     │  └─ workspace-panel.tsx
│     ├─ controls/
│     │  ├─ README.md
│     │  ├─ chat-composer-control.tsx
│     │  ├─ codex-model-selector.tsx
│     │  ├─ codex-utils.test.ts
│     │  ├─ codex-utils.ts
│     │  ├─ dropdown.tsx
│     │  ├─ icons.tsx
│     │  ├─ reasoning-effort-selector.tsx
│     │  ├─ search-utils.ts
│     │  ├─ sidebar-search-control.tsx
│     │  ├─ sidebar-section-header.tsx
│     │  └─ thread-access-control.tsx
│     ├─ index.css
│     ├─ index.html
│     ├─ index.ts
│     └─ input.css
└─ tsconfig.json
```
