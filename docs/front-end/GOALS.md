# Front-end Goals

This file tracks what the front-end research cron should keep learning next.
Read this file before any web research, then update it after each sweep so the backlog stays current.

## Top-Level Aims

- Keep the front-end docs tree organized, source-backed, and easy to navigate.
- Capture practical UI and UX techniques that improve clarity, usability, accessibility, and perceived quality.
- Convert repeat research into durable guidance instead of leaving it as scattered notes.
- Promote stable findings into patterns or principles before the research notes become too broad.
- Surface unresolved topics early so the next research pass has a clear target.

## Current Research Priorities

- Accessible forms, controls, and interaction affordances
- Microcopy and state messaging for empty, loading, and error states
- Motion and transitions that clarify state without adding noise
- Search, filtering, and progressive disclosure patterns
- Distinguishing shell navigation from in-page navigation in multi-panel workspaces

## Open Questions

- Which form validation contract should be standard across dialogs, side panels, and inline editors?
- Should the repo standardize `aria-describedby` plus `aria-errormessage` for custom validation states?
- What target-size minimum should the UI treat as the default for buttons, icon actions, and adjacent controls?
- Which breakpoint and collapse behavior best fits the repo's desktop-first shell?
- Should the shell use a temporary drawer, a rail, or both when the left nav collapses?
- How should focus restoration work after the collapsed navigation closes?
- When should breadcrumbs or page titles carry orientation at smaller widths?
- Which loading pattern should be the default for tables, side panels, and detail views?
- How should empty states and inline notifications interact when several panels are empty or failing at once?
- Which micro-interactions improve confidence without slowing expert users down?
- Which motion effects are essential, and which should disappear under reduced motion?
- Which search and filter controls should stay visible versus collapse into disclosure?
- How should selected filters and counts stay visible when the filter UI is collapsed?
- How should this repo distinguish between design principles, pattern notes, and implementation-ready guidance?

## Follow-Up Topics

- Form validation patterns for dialogs, panels, and inline editors
- Accessible labels, grouping, and affordance rules for custom controls
- Form validation and error-copy defaults for technical tools
- Mobile adaptation strategies for desktop-first interfaces
- Strong defaults for spacing, typography, and color systems in productivity UIs
- Empty-state and onboarding patterns for technical tools
- Discoverable but unobtrusive advanced controls
- Search and filtering patterns for dense workspaces
- Reduced-motion defaults for state transitions and loading surfaces
- Documentation structure patterns for keeping research notes tidy over time

## Recent Research

- [Accessible Forms, Controls, and Affordances](./research/2026-04-06-accessible-forms-controls-and-affordances.md)
- [Search, Filtering, and Progressive Disclosure](./research/2026-04-06-search-filtering-and-progressive-disclosure.md)
- [Motion and Reduced Motion Guardrails](./research/2026-04-06-motion-and-reduced-motion.md)
- [Responsive Shell and Sidebar Collapse](./research/2026-04-06-responsive-shell-and-sidebar-collapse.md)
- [Dense Workspace Hierarchy, Navigation, and Feedback States](./research/2026-04-06-dense-workspace-hierarchy-navigation-feedback.md)

## Recent Principles

- [Responsive Shell Navigation Principle](./principles/responsive-shell-navigation-principle.md)
- [Dense Workspace Shell Pattern](./patterns/dense-workspace-shell-pattern.md)
- [Form Validation Pattern](./patterns/form-validation-pattern.md)

## Sweep Checklist

- Confirm new research was filed in the right folder.
- Move or split documents that have become too broad.
- Add links from the index when a new topic file is created.
- Trim duplicate notes and stale questions.
- Promote recurring findings into principles or patterns when they are stable enough.
