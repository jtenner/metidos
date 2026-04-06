# Navigation Landmarks and Sidebar Patterns

Date: 2026-04-06

This research pass focused on how dense workspace UIs should separate shell navigation, page-scoped navigation, breadcrumbs, and tab-like content switching. The goal was to find implementation-friendly guidance for repeated navigation regions, collapse behavior, and landmark labeling without turning the shell into a sitemap.

## Summary

The current direction is to keep shell navigation shallow, label repeated navigation regions clearly, and move page-specific navigation into the page header or content body when it does not belong in the persistent shell. On narrower screens, the shell can collapse into a temporary drawer or side rail, but the collapsed state still needs to preserve orientation through active-state styling, `aria-current`, `aria-expanded`, skip links, and short, descriptive landmark labels. Breadcrumbs help with deeper location context, while tabs are for switching between related content on the same page rather than for page navigation.

## Source Notes

- [Carbon UI shell header usage](https://carbondesignsystem.com/components/UI-shell-header/usage/)
  - The shell header is the foundation for orienting users and can work alone or with left and right panels.
  - The left panel is the optional product-navigation surface.
  - Header links move into the left panel at narrow widths.
  - The skip-to-main link belongs at the start of the navigation focus order.
- [Carbon UI shell left panel accessibility](https://carbondesignsystem.com/components/UI-shell-left-panel/accessibility/)
  - The left panel is implemented as a `nav` region with `aria-label="Side navigation"`.
  - Nested `ul` structure gives assistive technology more context.
  - Sub-menus use buttons with `aria-expanded`.
  - Active links use `aria-current="page"`.
  - Carbon hides the left panel behind a hamburger button on smaller screens or around 175% zoom, and it also supports a side-rail variant.
- [Carbon UI shell left panel style](https://carbondesignsystem.com/components/UI-shell-left-panel/style/)
  - The left panel is fixed to the left edge and spans the full browser height.
  - Menu labels stay in sentence case.
  - Link, submenu, and selected states rely on a compact but explicit visual system rather than on extra chrome.
- [Atlassian Navigation system](https://atlassian.design/components/navigation-system/)
  - Atlassian now treats the Navigation system as the latest navigation approach for its apps.
  - Side navigation is a first-class navigation component and supports nested views.
  - Atlassian’s page-header component is the place for title plus breadcrumbs, buttons, search, and filters.
- [Atlassian Page header](https://atlassian.design/components/page-header/)
  - The page header defines the top of a page.
  - It can combine the title with breadcrumbs, buttons, search, and filters.
- [Atlassian Breadcrumbs](https://atlassian.design/components/breadcrumbs/)
  - Breadcrumbs are a navigation system used to show a user’s location in a site or app.
- [Atlassian layout grid and page layout](https://atlassian.design/foundations/grid-beta/)
  - Layout regions are distinct page building blocks.
  - Side navigation and asides are separate regions that reduce the main content area rather than compete with it.
  - Atlassian documents collapsed and default widths for side navigation, which reinforces that nav state is a layout concern, not just a styling change.
- [WAI Labeling Regions](https://www.w3.org/WAI/tutorials/page-structure/labels/)
  - Use `aria-labelledby` or `aria-label` to distinguish multiple page regions of the same type.
  - Labels should be short and descriptive.
  - Unique regions such as `main` do not need extra labels.
- [GOV.UK Tabs](https://design-system.service.gov.uk/components/tabs/)
  - Tabs are for switching between related sections on the same page.
  - GOV.UK explicitly says not to use tabs as a form of page navigation.
  - If users need to read content in order or compare sections, other structures are usually better.

## Practical Implications

- Keep one primary shell navigation surface and keep it shallow enough that the main workspace remains visible.
- Label repeated navigation regions distinctly, usually with `aria-labelledby` when a heading is already visible and `aria-label` only when the label should stay visually hidden.
- Use `aria-current="page"` for active navigation links and `aria-expanded` on disclosure buttons.
- Collapse the left panel into a drawer or side rail when it starts competing with content, but keep the main content reachable and the current location obvious.
- Put breadcrumbs in the page header when they clarify location in a deeper hierarchy.
- Treat tabs as in-page content switching, not site or workspace navigation.
- Keep page-specific controls with the page unless the control is truly global to the shell.
- Test collapsed navigation at zoomed text sizes, not just at viewport breakpoints.

## Follow-Up

- Compare shell navigation, in-page navigation, and breadcrumbs across the dense workspace screens.
- Decide whether the app’s collapsible left navigation should use a drawer, a side rail, or both at different widths.
- Check whether any tab-like page sections are doing navigation work that should move into page headers or separate pages.
- See [Responsive Shell and Sidebar Collapse](./2026-04-06-responsive-shell-and-sidebar-collapse.md) and [Page Header Orientation and Breadcrumbs](./2026-04-06-page-header-orientation-and-breadcrumbs.md) for adjacent guidance.
