# Page Header Orientation and Breadcrumbs

Date: 2026-04-06

This research pass focused on how dense workspace pages should use page headers, breadcrumbs, and nearby controls to orient users without turning the top of the page into a catch-all toolbar.

## Summary

Page headers work best as orientation regions. Keep the page title dominant, then add breadcrumbs, search, filters, or actions only when they help users understand where they are or what the page controls. Breadcrumbs are secondary navigation for deeper hierarchies, not a replacement for shell navigation or the main page content. On narrow screens, breadcrumbs should stay compact, collapse, or overflow instead of wrapping into a second line or dominating the first viewport. If a control only affects one table, panel, or card, keep it with that region instead of promoting it into the page header.

## Source Notes

- [Atlassian Page Header](https://atlassian.design/components/page-header/)
  - A page header defines the top of a page.
  - It contains a title and can optionally include breadcrumbs, buttons, search, and filters.
  - Atlassian frames the header as a structural component, not just a decorative title slot.
- [Atlassian Components Overview](https://atlassian.design/components/)
  - Page header sits in the layout and structure area alongside page layout components.
  - This placement reinforces that header composition is part of page structure.
- [Carbon Breadcrumb Usage](https://carbondesignsystem.com/components/breadcrumb/usage/)
  - Breadcrumbs are a secondary navigation pattern.
  - They help users understand hierarchy and move back through levels.
  - They are most useful when the information architecture has more than two levels.
  - Breadcrumbs should never replace primary navigation.
  - Small breadcrumbs are commonly used in page headers.
  - When space is limited, Carbon uses overflow rather than wrapping.
- [Carbon Breadcrumb Accessibility](https://carbondesignsystem.com/components/breadcrumb/accessibility/)
  - Breadcrumb links should be interactive except for the current page.
  - Carbon uses a navigation landmark for the breadcrumb region.
  - Truncated breadcrumbs keep the overflow control in the tab order.
- [Carbon Breadcrumb Style](https://carbondesignsystem.com/components/breadcrumb/style/)
  - Breadcrumb overflow is disclosed through a menu.
  - Breadcrumbs do not wrap to a second line.
  - Small and medium breadcrumb sizes exist so the component can fit page headers and denser spaces.
- [GOV.UK Breadcrumbs](https://design-system.service.gov.uk/components/breadcrumbs/)
  - Breadcrumbs help users understand and move between multiple levels of a website.
  - They should sit at the top of a page before `<main>`.
  - If the page already has other navigation such as a sidebar, breadcrumbs may not be necessary.
  - The component can collapse on smaller screens.
- [Microsoft Fluent Breadcrumb](https://learn.microsoft.com/en-us/fluent-ui/web-components/components/breadcrumb)
  - Breadcrumbs are a list of links to parent pages in hierarchical order.
  - They are typically placed before a page's main content.
- [Nielsen Norman Group, 5 Visual-design Principles in UX](https://media.nngroup.com/media/articles/attachments/Principles_Visual_Design-Letter.pdf)
  - Visual hierarchy works by guiding the eye in order of importance.
  - Scale and contrast do most of the work, so the header should not rely on decorative clutter to communicate importance.
  - A small number of type sizes helps dense pages stay scannable.

## Practical Implications

- Use the page header to keep the title dominant, then add local orientation controls only when they help the current task.
- Prefer breadcrumbs when the user needs to understand a deeper hierarchy or move to parent levels quickly.
- Skip breadcrumbs on flat pages or where the shell navigation already does enough orientation work.
- Keep the title dominant and let breadcrumbs stay visually secondary; if space is tight, collapse or truncate breadcrumbs before sacrificing the title.
- Keep breadcrumb labels short and meaningful, and do not make the current page a link unless the design system explicitly allows it for unclear titles.
- Treat search and filter controls in the header as page-scoped controls, not generic chrome.
- If a control only affects one list, table, card, or panel, keep it in that region's toolbar or body rather than elevating it into the page header. This is an inference from the source material, not a direct quoted rule.
- Give repeated landmarks unique labels when more than one breadcrumb or search region exists on a page.
- Use only a small number of heading or emphasis levels in the header so the orientation region stays scannable.

## Follow-Up

- Compare the repo's actual page headers against this orientation model, especially in dense detail views and list pages.
- Check whether breadcrumbs are necessary on pages that already have a strong shell navigation and visible titles.
- Verify which repo pages should keep breadcrumbs versus which should omit them because the shell already orients the user.
- Decide whether the header composition rules are stable enough to promote into a reusable pattern or principle.
- Revisit small-screen header behavior once the repo's mobile layouts are reviewed together with the sidebar-collapse note.
