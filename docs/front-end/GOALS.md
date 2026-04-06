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

- Information hierarchy, region labels, page headers, and visual structure in dense workspace pages
- Responsive typography, container-aware layout primitives, and page-header composition for dense panes and cards
- Loading, empty, and error feedback states
- Search, filtering, and progressive disclosure patterns
- Distinguishing shell navigation, breadcrumbs, and in-page navigation in multi-panel workspaces
- Motion and transitions that clarify state without adding noise
- Accessible forms affordances and post-interaction styling that remain clear at dense sizes

## Open Questions

- Where do the 24 by 24 CSS pixel target-size rules need spacing exceptions or equivalent controls in dense toolbars?
- Where should the app adopt the feedback-states pattern first: tables, panels, or detail views?
- When should feedback use `role="status"`, `role="alert"`, or `aria-busy`?
- How should no-results search states relate to the feedback-states pattern versus the search pattern?
- Which breakpoint and collapse behavior best fits the repo's desktop-first shell?
- Should the shell use a temporary drawer, a rail, or both when the left nav collapses at different widths?
- How should focus restoration work after the collapsed navigation closes?
- Which shell and page-scoped navigation regions need distinct labels, and where should breadcrumbs replace deeper shell nav?
- Which dense pages still need breadcrumbs once shell navigation and visible titles are in place?
- Which page-header controls belong in the header versus a local toolbar or body region?
- Which panes, cards, or dense content blocks should adopt container queries before viewport breakpoints?
- Where should `text-wrap: balance` stay limited to short headings, and where should it stay off?
- Which repeated regions should use `aria-labelledby` versus `aria-label` when labels are already visible?
- Where should productive type styles stay the default, and where is expressive typography actually warranted?
- Which micro-interactions improve confidence without slowing expert users down?
- Which motion effects are essential, and which should disappear under reduced motion?
- Which search and filter controls should stay visible versus collapse into disclosure?
- How should selected filters and counts stay visible when the filter UI is collapsed?
- Which shared form controls need a fallback class alongside `:user-invalid`?
- How should this repo distinguish between design principles, pattern notes, and implementation-ready guidance?
- How many distinct heading or emphasis levels are useful before a dense page starts to feel noisy?
- Should breadcrumb, page title, and section caption conventions be standardized across detail panes and mobile breakpoints?
- When should visual structure rely on spacing and proximity instead of additional separators or ornament?
- Which hierarchy conventions belong in semantic guidance versus layout-implementation guidance?

## Follow-Up Topics

- Validation timing exceptions for deterministic field-level checks
- Accessible labels, grouping, and affordance rules for custom controls
- Target-size defaults and spacing exceptions for dense toolbars and icon actions
- Feedback-state defaults for loading, empty, success, and error surfaces
- Page-header composition and breadcrumb conventions for dense workspace views
- Mobile adaptation strategies for desktop-first interfaces
- Strong defaults for spacing, typography, and color systems in productivity UIs
- Empty-state and onboarding patterns for technical tools
- Discoverable but unobtrusive advanced controls
- Search and filtering patterns for dense workspaces
- Reduced-motion defaults for state transitions and loading surfaces
- Documentation structure patterns for keeping research notes tidy over time
- `:user-invalid` fallback styling and support checks for post-interaction invalid states
- Responsive typography and container-aware layout primitives
- Navigation landmarks, sidebar collapse, and shell-vs-page navigation boundaries
- Short-heading balancing rules for scanable titles and captions

## Recent Research

- [Responsive Typography and Container-Aware Layout](./research/2026-04-06-responsive-typography-and-container-aware-layout.md)
- [Validation Timing and `:user-invalid` Styling](./research/2026-04-06-validation-timing-and-user-invalid-styling.md)
- [Page Header Orientation and Breadcrumbs](./research/2026-04-06-page-header-orientation-and-breadcrumbs.md)
- [Information Hierarchy and Visual Structure](./research/2026-04-06-information-hierarchy-and-visual-structure.md)
- [Loading, Empty, and Error Feedback States](./research/2026-04-06-loading-empty-error-feedback-states.md)
- [Accessible Forms, Controls, and Affordances](./research/2026-04-06-accessible-forms-controls-and-affordances.md)
- [Form Error Summary Focus Management](./research/2026-04-06-form-error-summary-focus-management.md)
- [Search, Filtering, and Progressive Disclosure](./research/2026-04-06-search-filtering-and-progressive-disclosure.md)
- [Motion and Reduced Motion Guardrails](./research/2026-04-06-motion-and-reduced-motion.md)
- [Responsive Shell and Sidebar Collapse](./research/2026-04-06-responsive-shell-and-sidebar-collapse.md)
- [Navigation Landmarks and Sidebar Patterns](./research/2026-04-06-navigation-landmarks-and-sidebar-patterns.md)
- [Dense Workspace Hierarchy, Navigation, and Feedback States](./research/2026-04-06-dense-workspace-hierarchy-navigation-feedback.md)

## Recent Principles

- [Responsive Shell Navigation Principle](./principles/responsive-shell-navigation-principle.md)

## Recent Patterns

- [Feedback States Pattern](./patterns/feedback-states-pattern.md)
- [Dense Workspace Shell Pattern](./patterns/dense-workspace-shell-pattern.md)
- [Form Validation Pattern](./patterns/form-validation-pattern.md)

## Recent Audits

- [Front-end Tree Sweep: Navigation Landmarks and Sidebar Patterns](./audits/2026-04-06-front-end-tree-sweep-navigation-landmarks.md)
- [Front-end Tree Sweep: Information Hierarchy and Layout Rhythm](./audits/2026-04-06-front-end-tree-sweep-information-hierarchy.md)
- [Front-end Tree Sweep: Responsive Layout Primitives Split](./audits/2026-04-06-front-end-tree-sweep-responsive-layout-primitives.md)
- [Front-end Tree Sweep: Validation Timing and `:user-invalid`](./audits/2026-04-06-front-end-tree-sweep-validation-timing-user-invalid.md)
- [Front-end Tree Sweep: Feedback States Split](./audits/2026-04-06-front-end-tree-sweep-feedback-states.md)
- [Front-end Tree Sweep Follow-up](./audits/2026-04-06-front-end-tree-sweep-followup.md)
- [Front-end Tree Sweep: Form Error Summary Focus](./audits/2026-04-06-front-end-tree-sweep-form-error-summary-focus.md)

## Sweep Checklist

- Confirm new research was filed in the right folder.
- Move or split documents that have become too broad.
- Add links from the index when a new topic file is created.
- Trim duplicate notes and stale questions.
- Promote recurring findings into principles or patterns when they are stable enough.
