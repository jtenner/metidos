# Dense Workspace Hierarchy, Navigation, and Feedback States

Date: 2026-04-06

This research pass focused on practical patterns for dense developer tools: how to keep the shell scannable, how to structure sidebar navigation, and how to handle loading, empty, and error states without overwhelming the interface.

## Summary

The strongest current guidance is to keep the workspace shell shallow and predictable, use progressive disclosure instead of deep nested navigation, and match the feedback pattern to the scope of the wait or error. For large content areas, skeletons are better than spinners for initial load; for single async actions, inline loading works better; for missing data, replace the absent content with an empty state rather than layering a message on top of it.

## Source Notes

- [Carbon UI shell left panel accessibility](https://carbondesignsystem.com/components/UI-shell-left-panel/accessibility/)
  - The left panel is exposed as a `<nav>` with `aria-label="Side navigation"`.
  - Nested lists are used for structure.
  - Sub-menus are buttons with `aria-expanded`.
  - Active links use `aria-current="page"`.
- [Carbon UI shell header usage](https://carbondesignsystem.com/components/UI-shell-header/usage/)
  - The shell is made of the header, left panel, and right panel.
  - Header links collapse into the left panel on narrower screens.
  - A "Skip to main" link belongs at the start of the navigation focus order.
- [Carbon tree view usage](https://carbondesignsystem.com/components/tree-view/usage/)
  - Carbon recommends the UI shell left panel for product navigation.
  - Pairing the left panel with breadcrumbs can support information architectures several levels deep.
- [Carbon loading pattern](https://carbondesignsystem.com/patterns/loading-pattern/)
  - Skeleton states represent the page structure while content is still being gathered.
  - Inline loading is appropriate for a single component or action.
  - Full-screen loading is for whole-page or large-section processing.
- [Carbon loading component](https://carbondesignsystem.com/components/loading/usage/)
  - Use a loading indicator if the expected wait time exceeds three seconds.
  - Prefer skeletons for progressively displayed content.
  - Avoid multiple loading indicators at once.
- [Carbon inline loading component](https://carbondesignsystem.com/components/inline-loading/usage/)
  - Inline loading should stay in the same spot as the action it represents.
  - Disable related controls while the action is loading.
  - Use inline notification or form error handling when the action fails.
- [Carbon empty states pattern](https://carbondesignsystem.com/patterns/empty-states-pattern/)
  - Empty states should appear in the space where content would normally render.
  - Replace the missing element rather than showing the empty message alongside the underlying structure.
  - Keep copy short and focused on one clear next step.
  - If multiple empty states can appear at once, prefer a tertiary action to avoid competing primary buttons.
- [Carbon forms pattern](https://carbondesignsystem.com/patterns/forms-pattern/)
  - Helper text should stay short and specific.
  - Use inline errors whenever possible.
  - Field guidance should be close to the input and not hidden in a tooltip.
- [Carbon form usage](https://carbondesignsystem.com/components/form/usage/)
  - Validation messages should explain incorrect or missing input.
  - Helper text should help users complete the field correctly.
- [Carbon text input accessibility](https://carbondesignsystem.com/components/text-input/accessibility/)
  - Helper text and error messages are exposed to assistive technologies.
  - Required fields should be identified programmatically.
- [Carbon notification pattern](https://carbondesignsystem.com/patterns/notification-pattern/)
  - Inline notifications belong near the related work area.
  - Task-generated notifications should provide direct, immediate feedback.
  - Keep notifications minimally disruptive and scoped to the relevant workflow.
- [Carbon notification component usage](https://carbondesignsystem.com/components/notification/usage/)
  - Inline notifications usually appear at the top of the primary content area.
  - Low-contrast notifications are less disruptive when the message is informational.
- [Nielsen Norman Group Designing for Young Adults](https://media.nngroup.com/media/reports/free/Designing_for_Young_Adults_3rd_Edition.pdf)
  - Dense pages scan better when the most important heading is visually dominant.
  - Grouped headings and short sections make long pages easier to scan.
- [Nielsen Norman Group Mobile Intranets and Enterprise Apps](https://media.nngroup.com/media/reports/free/Mobile_Intranets_and_Enterprise_Apps.pdf)
  - Progressive disclosure helps keep enterprise content understandable.
  - Stage labels help users stay oriented while drilling down.

## Practical Implications

- Keep the main workspace shell to two navigation levels max.
- Use a fixed shell nav for major product areas and reserve tabs or in-page controls for finer-grained switching.
- Prefer skeletons for initial page and table loads; use inline loading only for a narrow, local action.
- Replace missing content with an empty state, not a message over existing structure.
- Keep one primary next step per empty state whenever possible.
- Use inline field validation and nearby error copy for forms and dialogs.

## Follow-Up

- Compare responsive collapse behavior for the shell against the repo's actual mobile breakpoints.
- Collect more examples of dense multi-pane workspaces that use tabs, split panels, or contextual sidebars well.
- Decide which of these findings should be promoted into a durable principle vs. a reusable pattern.
