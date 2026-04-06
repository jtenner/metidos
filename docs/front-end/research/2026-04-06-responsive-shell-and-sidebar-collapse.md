# Responsive Shell and Sidebar Collapse

Date: 2026-04-06

This research pass focused on how dense, desktop-first shells should adapt when width is constrained. The main questions were when to collapse persistent navigation, how to preserve orientation, and how to keep the shell accessible as it changes shape.

## Summary

The strongest current guidance is to keep the shell responsive by content, not by device, and to treat collapsed navigation as a temporary surface rather than a second permanent layout. On wider screens, a persistent sidebar is fine. On narrower screens, the shell should move repeated navigation out of the way, keep a clear route to the main content, and preserve focus order and landmarks so keyboard and assistive-technology users do not have to fight the chrome.

## Source Notes

- [MDN Responsive web design](https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/CSS_layout/Responsive_Design)
  - Responsive design is an approach, not a separate technology.
  - Mobile-first layouts are a common best practice.
  - Breakpoints should be based on content needs.
  - Relative units are preferred for media query thresholds.
  - Flexbox and grid are responsive by default and work well for shell layouts.
- [Carbon UI shell header usage](https://carbondesignsystem.com/components/UI-shell-header/usage/)
  - The shell is composed of header, left panel, and right panel regions.
  - Header links collapse into the left panel on narrower screens.
  - A skip-to-main link belongs at the start of the navigation focus order.
- [Carbon UI shell left panel accessibility](https://carbondesignsystem.com/components/UI-shell-left-panel/accessibility/)
  - The left panel is exposed as a navigation landmark.
  - Submenus should use buttons with `aria-expanded`.
  - Active links should use `aria-current="page"`.
- [Carbon tree view usage](https://carbondesignsystem.com/components/tree-view/usage/)
  - Product navigation belongs in the shell left panel.
  - Breadcrumbs can help when information architecture is deeper than the nav levels.
- [WAI ARIA11: Using ARIA landmarks to identify regions of a page](https://www.w3.org/WAI/WCAG22/Techniques/aria/ARIA11)
  - Landmarks help users orient themselves on the page.
  - Landmarks let keyboard and assistive-technology users bypass repeated blocks of content.
  - Navigation and main landmarks are especially helpful in app-like shells.

## Practical Implications

- Keep persistent navigation on wide viewports, but collapse it once it starts competing with the main work area.
- Treat the collapsed nav as a temporary drawer or menu, not as a permanently cramped sidebar.
- Put skip links and landmarks in place before worrying about micro-interactions.
- Use `aria-current`, `aria-expanded`, and visible selected states together so the shell stays understandable when it resizes.
- Base breakpoints on where the content becomes cramped, then encode them with relative units.
- Prefer flex and grid for shell structure so the layout can reflow instead of forcing fixed widths.

## Follow-Up

- Verify the repo's actual collapse breakpoint against these content-driven rules.
- Decide whether the shell should offer a drawer-only collapse, a rail, or a hybrid.
- Research the best focus-restoration behavior after the navigation closes.
- Compare whether breadcrumbs or title/subtitle metadata should carry primary orientation at smaller widths. See [Page Header Orientation and Breadcrumbs](./2026-04-06-page-header-orientation-and-breadcrumbs.md) for the header-specific guidance.
