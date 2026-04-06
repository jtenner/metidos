# Front-end Goals

This file tracks what the front-end research cron should keep learning next.
Read this file before any web research, then update it after each sweep so the backlog stays current.

## Top-Level Aims

- Keep the front-end docs tree organized, source-backed, and easy to navigate.
- Capture practical UI and UX techniques that improve clarity, usability, accessibility, and perceived quality.
- Convert repeat research into durable guidance instead of leaving it as scattered notes.
- Surface unresolved topics early so the next research pass has a clear target.

## Current Research Priorities

- Motion and transitions that clarify state without adding noise
- Search, filtering, and progressive disclosure patterns
- Accessible forms, controls, and interaction affordances
- Microcopy and state messaging for empty, loading, and error states
- Distinguishing shell navigation from in-page navigation in multi-panel workspaces

## Open Questions

- Which breakpoint and collapse behavior best fits the repo's desktop-first shell?
- Should the shell use a temporary drawer, a rail, or both when the left nav collapses?
- How should focus restoration work after the collapsed navigation closes?
- When should breadcrumbs or page titles carry orientation at smaller widths?
- Which loading pattern should be the default for tables, side panels, and detail views?
- How should empty states and inline notifications interact when several panels are empty or failing at once?
- Which form validation rules should be standardized across dialogs, side panels, and inline editors?
- Which micro-interactions improve confidence without slowing expert users down?
- How should this repo distinguish between design principles, pattern notes, and implementation-ready guidance?

## Follow-Up Topics

- Mobile adaptation strategies for desktop-first interfaces
- Strong defaults for spacing, typography, and color systems in productivity UIs
- Empty-state and onboarding patterns for technical tools
- Discoverable but unobtrusive advanced controls
- Form validation and error-copy patterns for technical tools
- Documentation structure patterns for keeping research notes tidy over time

## Recent Research

- [Responsive Shell and Sidebar Collapse](./research/2026-04-06-responsive-shell-and-sidebar-collapse.md)
- [Dense Workspace Hierarchy, Navigation, and Feedback States](./research/2026-04-06-dense-workspace-hierarchy-navigation-feedback.md)

## Recent Principles

- [Responsive Shell Navigation Principle](./principles/responsive-shell-navigation-principle.md)
- [Dense Workspace Shell Pattern](./patterns/dense-workspace-shell-pattern.md)

## Sweep Checklist

- Confirm new research was filed in the right folder.
- Move or split documents that have become too broad.
- Add links from the index when a new topic file is created.
- Trim duplicate notes and stale questions.
- Promote recurring findings into principles or patterns when they are stable enough.
