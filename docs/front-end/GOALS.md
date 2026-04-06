# Front-end Goals

This file tracks what the front-end research cron should keep learning next.
Read this file before any web research, then update it after each sweep so the backlog stays current.

## User Supplied Research Sources

- https://atomicdesign.bradfrost.com/table-of-contents/
- https://www.merixstudio.com/blog/best-frontend-development-blogs
- https://github.com/anthropics/claude-code/blob/main/plugins/frontend-design/skills/frontend-design/SKILL.md
- https://www.nngroup.com/articles/homepage-design-principles/
- https://graphicdesign.stackexchange.com/questions/36884/what-are-the-steps-in-designing-a-website
- https://larryludwig.com/website-layout-best-practices/
- https://www.commoninja.com/blog/guide-to-website-layouts
- https://selfmadedesigner.com/website-layouts/


## Top-Level Aims

- Keep the front-end docs tree organized, source-backed, and easy to navigate.
- Capture practical UI and UX techniques that improve clarity, usability, accessibility, and perceived quality.
- Convert repeat research into durable guidance instead of leaving it as scattered notes.
- Promote stable findings into patterns or principles before the research notes become too broad.
- Surface unresolved topics early so the next research pass has a clear target.

## Current Research Priorities

- Information hierarchy and visual structure in dense workspace pages
- Loading, empty, and error feedback states
- Accessible forms, error summaries, and validation timing
- Motion and transitions that clarify state without adding noise
- Search, filtering, and progressive disclosure patterns
- Distinguishing shell navigation from in-page navigation in multi-panel workspaces

## Open Questions

- When should dialogs, side panels, and inline editors use a top-of-surface error summary versus only a focused first-invalid field?
- Should the repo standardize `novalidate` anywhere custom validation UI is used?
- Where do the 24 by 24 CSS pixel target-size rules need spacing exceptions or equivalent controls in dense toolbars?
- Where should the app adopt the feedback-states pattern first: tables, panels, or detail views?
- When should feedback use `role="status"`, `role="alert"`, or `aria-busy`?
- How should no-results search states relate to the feedback-states pattern versus the search pattern?
- Which breakpoint and collapse behavior best fits the repo's desktop-first shell?
- Should the shell use a temporary drawer, a rail, or both when the left nav collapses?
- How should focus restoration work after the collapsed navigation closes?
- When should breadcrumbs or page titles carry orientation at smaller widths?
- Which micro-interactions improve confidence without slowing expert users down?
- Which motion effects are essential, and which should disappear under reduced motion?
- Which search and filter controls should stay visible versus collapse into disclosure?
- How should selected filters and counts stay visible when the filter UI is collapsed?
- How should this repo distinguish between design principles, pattern notes, and implementation-ready guidance?
- How many distinct heading or emphasis levels are useful before a dense page starts to feel noisy?
- Should breadcrumb, page title, and section caption conventions be standardized across detail panes and mobile breakpoints?
- When should visual structure rely on spacing and proximity instead of additional separators or ornament?

## Follow-Up Topics

- Error summary focus management for dialogs, panels, and inline editors
- Blur-time versus submit-time validation timing
- Accessible labels, grouping, and affordance rules for custom controls
- Target-size defaults and spacing exceptions for dense toolbars and icon actions
- Feedback-state defaults for loading, empty, success, and error surfaces
- Mobile adaptation strategies for desktop-first interfaces
- Strong defaults for spacing, typography, and color systems in productivity UIs
- Empty-state and onboarding patterns for technical tools
- Discoverable but unobtrusive advanced controls
- Search and filtering patterns for dense workspaces
- Reduced-motion defaults for state transitions and loading surfaces
- Documentation structure patterns for keeping research notes tidy over time

## Recent Research

- [Information Hierarchy and Visual Structure](./research/2026-04-06-information-hierarchy-and-visual-structure.md)
- [Loading, Empty, and Error Feedback States](./research/2026-04-06-loading-empty-error-feedback-states.md)
- [Accessible Forms, Controls, and Affordances](./research/2026-04-06-accessible-forms-controls-and-affordances.md)
- [Search, Filtering, and Progressive Disclosure](./research/2026-04-06-search-filtering-and-progressive-disclosure.md)
- [Motion and Reduced Motion Guardrails](./research/2026-04-06-motion-and-reduced-motion.md)
- [Responsive Shell and Sidebar Collapse](./research/2026-04-06-responsive-shell-and-sidebar-collapse.md)
- [Dense Workspace Hierarchy, Navigation, and Feedback States](./research/2026-04-06-dense-workspace-hierarchy-navigation-feedback.md)

## Recent Principles

- [Responsive Shell Navigation Principle](./principles/responsive-shell-navigation-principle.md)

## Recent Patterns

- [Feedback States Pattern](./patterns/feedback-states-pattern.md)
- [Dense Workspace Shell Pattern](./patterns/dense-workspace-shell-pattern.md)
- [Form Validation Pattern](./patterns/form-validation-pattern.md)

## Recent Audits

- [Front-end Tree Sweep: Feedback States Split](./audits/2026-04-06-front-end-tree-sweep-feedback-states.md)
- [Front-end Tree Sweep Follow-up](./audits/2026-04-06-front-end-tree-sweep-followup.md)

## Sweep Checklist

- Confirm new research was filed in the right folder.
- Move or split documents that have become too broad.
- Add links from the index when a new topic file is created.
- Trim duplicate notes and stale questions.
- Promote recurring findings into principles or patterns when they are stable enough.
