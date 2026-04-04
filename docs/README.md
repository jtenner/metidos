# Docs

This folder holds internal notes, design decisions, and migration/audit documents about the architecture and observed behavior over time.
The files are primarily for maintainers and contributors to understand tradeoffs, known risks, and expected behavior before making UI/runtime changes.

## Files

- `2026-03-31-correctness-issues.md`
  - Historical correctness/performance audit snapshot; findings tied to async orchestration, polling, and UI state races.
- `2026-03-31-correctness-issues-2.md`
  - Historical follow-up/round 2 correctness audit snapshot with additional findings and refined severity list.
- `2026-04-03-security-audit.md`
  - Historical security audit snapshot covering transport, RPC surface, filesystem access, Codex/MCP execution model, and local persistence.
- `2026-04-03-security-audit-followup.md`
  - Follow-up security audit snapshot after the first remediation pass.
  - Focuses on remaining auth write-surface, task-file containment, default privilege, and sidecar isolation risks.
- `2026-04-03-security-remediation-plan.md`
  - Security implementation sequence drafted from that audit; includes auth model, step-up auth, transport hardening, TLS handling, and least-privilege defaults.
- `2026-04-04-correctness-audit.md`
  - Current correctness audit snapshot for the April 4 recheck.
  - Focuses on startup restore drift, active-worktree validation, project close rollback, sidecar scope contract drift, and initial RPC boot resilience.
- `codex.md`
  - Notes on the `@openai/codex-sdk` and how the app wires it to a local CLI-sidecar model runtime.
  - Documents expected thread/session behavior and the integration surface the backend uses.
- `codex-context-management.md`
  - Research note on Codex context continuity and how this repo manages thread state versus API-level conversation primitives.
  - Explains persistence behavior and the current approach to resumes/restarts.
- `data-request-priority-audit.md`
  - Audit of read request flows from browser to backend.
  - Catalogs latency and cancellation/priority pain points across transport and polling paths.
- `react-virtuoso-chat-migration.md`
  - Proposed migration plan for chat transcript rendering with `react-virtuoso`.
  - Focuses on virtualization approach, performance tradeoffs, and current behavior to preserve.
- `tanstack-virtual-chat-migration.md`
  - Alternative migration plan using `@tanstack/react-virtual`.
  - Documents compatibility tradeoffs, implementation shape, and list rendering strategy.

## Subfolder: `docs/references/`

The `references` directory stores design screenshots and captured HTML snapshots used for UI behavior comparison and visual context.

- `ai_chat_mobile/code.html`
- `ai_chat_mobile/screen.png`
  - Captures a mobile chat view reference case for UI layout and interactions.
- `codex_view/code.html`
- `codex_view/screen.png`
  - Captures the Codex-centric workspace reference state.
- `compact_diff_view_desktop/code.html`
- `compact_diff_view_desktop/screen.png`
  - Desktop reference for compact diff panel presentation.
- `compact_diff_view_mobile/code.html`
- `compact_diff_view_mobile/screen.png`
  - Mobile version of the compact diff layout/reference.
- `file_editor_mobile/code.html`
- `file_editor_mobile/screen.png`
  - Mobile file editor-focused reference.
- `file_tree_view/code.html`
- `file_tree_view/screen.png`
  - Reference for file-tree navigation and sidebar/tree behavior.
- `task_list_mobile/code.html`
- `task_list_mobile/screen.png`
  - Mobile task list reference behavior.
- `updated_tasks_view/code.html`
- `updated_tasks_view/screen.png`
  - Reference for the updated tasks UI state.
