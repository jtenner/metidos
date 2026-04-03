# Docs

This folder holds internal notes, design decisions, and migration/audit documents that describe current architecture and planned work.  
The files are primarily for maintainers and contributors to understand tradeoffs, known risks, and expected behavior before making UI/runtime changes.

## Files

- `2026-03-31-correctness-issues.md`
  - Initial correctness/performance audit with findings tied to async orchestration, polling, and UI state races.
- `2026-03-31-correctness-issues-2.md`
  - Follow-up/round 2 correctness audit with additional findings and refined severity list.
- `2026-04-03-security-audit.md`
  - Security audit of the app's transport, RPC surface, filesystem access, Codex/MCP execution model, and local persistence.
- `2026-04-03-security-remediation-plan.md`
  - Implementation plan for locking down access, adding password plus TOTP authentication, step-up auth, TLS policy, and backend default-deny behavior.
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
