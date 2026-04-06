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

- [Frontend Feedback Inventory](../2026-04-04-frontend-feedback-inventory.md)
- [Frontend Performance Inventory](../2026-04-04-frontend-performance-inventory.md)

## Recent Front-end Notes

- [Front-end Tree Sweep: Information Hierarchy and Layout Rhythm](./audits/2026-04-06-front-end-tree-sweep-information-hierarchy.md)
- [Responsive Typography and Container-Aware Layout](./research/2026-04-06-responsive-typography-and-container-aware-layout.md)
- [Front-end Tree Sweep: Responsive Layout Primitives Split](./audits/2026-04-06-front-end-tree-sweep-responsive-layout-primitives.md)
- [Validation Timing and `:user-invalid` Styling](./research/2026-04-06-validation-timing-and-user-invalid-styling.md)
- [Front-end Tree Sweep: Validation Timing and `:user-invalid`](./audits/2026-04-06-front-end-tree-sweep-validation-timing-user-invalid.md)
- [Form Error Summary Focus Management](./research/2026-04-06-form-error-summary-focus-management.md)
- [Front-end Tree Sweep: Form Error Summary Focus](./audits/2026-04-06-front-end-tree-sweep-form-error-summary-focus.md)
- [Information Hierarchy and Visual Structure](./research/2026-04-06-information-hierarchy-and-visual-structure.md)
- [Front-end Tree Sweep: Validation and Target Size](./audits/2026-04-06-front-end-tree-sweep-validation-target-size.md)
- [Loading, Empty, and Error Feedback States](./research/2026-04-06-loading-empty-error-feedback-states.md)
- [Feedback States Pattern](./patterns/feedback-states-pattern.md)
- [Front-end Tree Sweep: Feedback States Split](./audits/2026-04-06-front-end-tree-sweep-feedback-states.md)
- [Accessible Forms, Controls, and Affordances](./research/2026-04-06-accessible-forms-controls-and-affordances.md)
- [Form Validation Pattern](./patterns/form-validation-pattern.md)
- [Search, Filtering, and Progressive Disclosure](./research/2026-04-06-search-filtering-and-progressive-disclosure.md)
- [Motion and Reduced Motion Guardrails](./research/2026-04-06-motion-and-reduced-motion.md)
- [Front-end Tree Sweep Follow-up](./audits/2026-04-06-front-end-tree-sweep-followup.md)
- [Responsive Shell and Sidebar Collapse](./research/2026-04-06-responsive-shell-and-sidebar-collapse.md)
- [Responsive Shell Navigation Principle](./principles/responsive-shell-navigation-principle.md)
- [Dense Workspace Hierarchy, Navigation, and Feedback States](./research/2026-04-06-dense-workspace-hierarchy-navigation-feedback.md)
- [Dense Workspace Shell Pattern](./patterns/dense-workspace-shell-pattern.md)
- [Front-end Tree Sweep](./audits/2026-04-06-front-end-tree-sweep.md)
