# Dense Workspace Shell Pattern

Use this pattern for developer tools and other data-dense products that need a persistent shell, a sidebar, and clear state feedback.

## When to Use

- The product has several primary sections that users revisit often.
- The interface combines a shell nav with a main content area and one or more detail panels.
- Users need to move quickly between overview, list, and detail views without losing context.

## Structure

- Keep the shell shallow.
- Use the header for global actions and the left panel for primary workspace navigation.
- Use the page header for the page title and any local orientation controls such as breadcrumbs, search, or filters when they help the current task.
- Keep navigation to two levels, and move deeper detail into page tabs or in-content controls.
- Use sentence case for menu labels.
- Keep the active location obvious with a selected state and `aria-current="page"` on the active link.

## Responsive Behavior

- Keep the left panel persistent on wider viewports where it does not compete with the main workspace.
- Collapse the left panel into a temporary drawer or menu when width becomes cramped.
- Keep the header and main content usable while the drawer is closed.
- Place skip-to-main and landmark semantics in the shell before adding more elaborate motion.
- Use content-driven breakpoints and relative units so the collapse happens when the layout needs it, not when a device class says it should.

## Avoid

- A three-tier navigation stack in the shell.
- Forcing a permanent expanded sidebar on narrow screens.
- Hiding repeated shell navigation without providing landmarks or a clear route to the main content.
- Putting page-scoped orientation controls in the shell header when they belong with the page content.

## Related Patterns

- [Feedback States Pattern](../patterns/feedback-states-pattern.md)

## Related Research

- [Dense Workspace Hierarchy, Navigation, and Feedback States](../research/2026-04-06-dense-workspace-hierarchy-navigation-feedback.md)
- [Responsive Shell and Sidebar Collapse](../research/2026-04-06-responsive-shell-and-sidebar-collapse.md)
- [Page Header Orientation and Breadcrumbs](../research/2026-04-06-page-header-orientation-and-breadcrumbs.md)
- [Accessible Forms, Controls, and Affordances](../research/2026-04-06-accessible-forms-controls-and-affordances.md)

## Related Principles

- [Responsive Shell Navigation Principle](../principles/responsive-shell-navigation-principle.md)
