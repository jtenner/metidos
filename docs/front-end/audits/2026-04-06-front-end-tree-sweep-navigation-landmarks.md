# Front-end Tree Sweep: Navigation Landmarks and Sidebar Patterns

Date: 2026-04-06

## What Changed

- Added a source-backed research note for navigation landmarks and sidebar patterns.
- Cross-linked the new note from the shell pattern, the shell navigation principle, the front-end README, and `GOALS.md`.
- Updated `AGENTS.md` so the file tree snapshot includes the new navigation research and sweep note.

## Organization Check

- Navigation and sidebar guidance stayed specific enough to live in one research note.
- No duplicate file needed to be merged.
- Tabs guidance remains separate because it governs in-page switching, not page navigation.
- Shell orientation guidance still belongs in the principle and shell pattern; the new note covers nav semantics, landmarks, and collapse behavior.

## Follow-Up

- Promote stable nav-labeling guidance into the pattern layer if it keeps showing up in implementation work.
- Keep checking whether any page-scoped navigation controls are drifting into the persistent shell.
