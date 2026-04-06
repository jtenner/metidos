# Dense Workspace Shell Pattern

Use this pattern for developer tools and other data-dense products that need a persistent shell, a sidebar, and clear state feedback.

## When to Use

- The product has several primary sections that users revisit often.
- The interface combines a shell nav with a main content area and one or more detail panels.
- Users need to move quickly between overview, list, and detail views without losing context.

## Structure

- Keep the shell shallow.
- Use the header for global actions and the left panel for primary workspace navigation.
- Keep navigation to two levels, and move deeper detail into page tabs or in-content controls.
- Use sentence case for menu labels.
- Keep the active location obvious with a selected state and `aria-current="page"` on the active link.

## Responsive Behavior

- Keep the left panel persistent on wider viewports where it does not compete with the main workspace.
- Collapse the left panel into a temporary drawer or menu when width becomes cramped.
- Keep the header and main content usable while the drawer is closed.
- Place skip-to-main and landmark semantics in the shell before adding more elaborate motion.
- Use content-driven breakpoints and relative units so the collapse happens when the layout needs it, not when a device class says it should.

## Feedback States

- Use skeletons for initial loads of tables, cards, panels, and other container-based content.
- Use inline loading for a single action that is in progress.
- Use progressive loading when a large page can reveal useful structure before all content is ready.
- Replace an empty region with an empty state instead of leaving surrounding chrome in place.
- Keep error and empty-state copy local to the affected area.

## Forms and Validation

- Validate as early as the field can be meaningfully checked, usually on blur.
- Place error text directly near the field.
- Make the message specific about what is wrong and how to fix it.
- Disable submit only when the resulting feedback remains visible and the form is short enough that the user can recover easily.

## Avoid

- A three-tier navigation stack in the shell.
- Multiple primary buttons in adjacent empty states.
- Skeletons for controls that the user must interact with, such as buttons, dropdowns, or dialogs.
- Full-page spinners for content that could be revealed progressively.
- Generic error text that does not explain the next step.
- Forcing a permanent expanded sidebar on narrow screens.
- Hiding repeated shell navigation without providing landmarks or a clear route to the main content.

## Related Research

- [Dense Workspace Hierarchy, Navigation, and Feedback States](../research/2026-04-06-dense-workspace-hierarchy-navigation-feedback.md)
- [Responsive Shell and Sidebar Collapse](../research/2026-04-06-responsive-shell-and-sidebar-collapse.md)

## Related Principles

- [Responsive Shell Navigation Principle](../principles/responsive-shell-navigation-principle.md)
