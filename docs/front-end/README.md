# Front-end Research Index

This folder stores the working knowledge base for web UI and UX research.
The cron job that maintains it should always read `GOALS.md` first, then decide what to research, where to file it, and whether the tree needs a sweep.

## Maintenance Rules

- Check `GOALS.md` before doing any new research.
- Prefer source-backed notes and concise summaries over duplicated narrative.
- Keep related information together in the most specific file that fits.
- If research changes the structure, update this index at the same time.
- When a topic grows, split it into a more specific document instead of letting one file accumulate unrelated notes.

## Document Structure

- `GOALS.md`
  - Current research aims, open questions, and follow-up topics.
- `research/`
  - Source-backed research notes, dated investigations, and web findings.
- `principles/`
  - Distilled UI and UX principles that should inform implementation work.
- `patterns/`
  - Reusable interaction, layout, and component patterns.
- `audits/`
  - Sweep notes, organization checks, and doc health reviews.

## Workflow

1. Read `GOALS.md`.
2. Research one or more focused web UI or UX topics.
3. Update an existing document or create a new one in the most appropriate location.
4. Sweep the tree for structure, duplication, and missing cross-links.
5. Refresh `GOALS.md` with new follow-up work and unresolved questions.

## Related Docs

- [Frontend Feedback Inventory](/home/jtenner/Projects/jt-ide/docs/2026-04-04-frontend-feedback-inventory.md)
- [Frontend Performance Inventory](/home/jtenner/Projects/jt-ide/docs/2026-04-04-frontend-performance-inventory.md)

## Recent Front-end Notes

- [Responsive Shell and Sidebar Collapse](./research/2026-04-06-responsive-shell-and-sidebar-collapse.md)
- [Responsive Shell Navigation Principle](./principles/responsive-shell-navigation-principle.md)
- [Dense Workspace Hierarchy, Navigation, and Feedback States](./research/2026-04-06-dense-workspace-hierarchy-navigation-feedback.md)
- [Dense Workspace Shell Pattern](./patterns/dense-workspace-shell-pattern.md)
- [Front-end Tree Sweep](./audits/2026-04-06-front-end-tree-sweep.md)
