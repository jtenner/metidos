# Information Hierarchy and Visual Structure

Date: 2026-04-06

This research pass focused on how dense web UIs communicate structure before users read every line. The goal was to find implementation-friendly rules for headings, spacing, grouping, and component-level layout that keep workspace pages scannable at desktop and small-screen sizes. The responsive type and container-aware implementation details that support this hierarchy are tracked in a dedicated note. Page-header composition and breadcrumb conventions are tracked separately in [Page Header Orientation and Breadcrumbs](./2026-04-06-page-header-orientation-and-breadcrumbs.md).

## Summary

Strong hierarchy comes from semantic structure plus consistent visual rhythm. Use heading ranks to mirror page sections, label page regions when landmarks repeat, and keep line length and type scale under control so the page stays readable when resized or magnified. Within dense layouts, related controls should stay close to the content they affect, and the layout should not depend on tiny visual distinctions to communicate grouping. For short headings and captions, `text-wrap: balance` can improve the visual shape of wrapped text without changing the underlying hierarchy. Design systems increasingly treat page headers, grids, and type tokens as part of the hierarchy system rather than separate layout concerns.

## Source Notes

- [WAI Page Structure Tutorial](https://www.w3.org/WAI/tutorials/page-structure/)
  - Headings should be nested logically so the page structure is understandable before the content is fully read.
  - Labels and headings work together to make repeated regions easier to scan and navigate.
- [WAI Headings](https://www.w3.org/WAI/tutorials/page-structure/headings/)
  - Headings communicate page organization and support in-page navigation.
  - Nest heading ranks in order; avoid skipping levels where possible.
  - Fixed regions like sidebars should keep their own heading structure consistent across pages.
  - Use `aria-labelledby` to associate headings with page regions.
- [WAI Labeling Regions](https://www.w3.org/WAI/tutorials/page-structure/labels/)
  - Distinguish repeated regions of the same type with `aria-labelledby` or `aria-label`.
  - Unique landmarks like `main` do not need extra labels.
- [WAI Landmark Regions APG](https://www.w3.org/WAI/ARIA/apg/practices/landmark-regions/)
  - Give each landmark a meaningful role and label so assistive-technology users can understand the page structure quickly.
  - If a page has more than one landmark of the same type, each should get a unique label.
- [GOV.UK Styles](https://design-system.service.gov.uk/styles/)
  - Page structure, typography, and spacing are grouped as the foundational pieces of a page.
  - The system warns against inventing new meanings for colors or changing core component styles because hierarchy should come from the established system, not local decoration.
- [GOV.UK Layout](https://design-system.service.gov.uk/styles/layout/)
  - Small screens start as a single-column layout.
  - Two-thirds layouts help keep line length readable on desktop.
  - The guidance is framed around screen size and content needs rather than device labels.
- [GOV.UK Type Scale](https://design-system.service.gov.uk/styles/type-scale/)
  - The type scale creates a consistent vertical rhythm that makes pages easier to scan and read.
  - Relative units help type resize better when zoomed or magnified.
  - Use the existing type scale when creating new components.
- [GOV.UK Headings](https://design-system.service.gov.uk/styles/headings/)
  - Headings should establish the page structure and support scanning.
  - The page title should be the most prominent heading on the page.
- [Atlassian Page Header](https://atlassian.design/components/page-header/)
  - A page header can combine a title with breadcrumbs, buttons, search, and filters.
  - This makes the header a practical orientation region, not just a title slot.
- [Atlassian Applying Typography](https://atlassian.design/foundations/typography/applying-typography)
  - Use heading styles and type tokens to establish the correct hierarchy.
  - Keep headings succinct so they summarize content rather than repeat it.
- [Atlassian Spacing](https://atlassian.design/foundations/spacing)
  - Spacing helps users quickly understand relationships between elements and creates order and hierarchy.
- [Carbon Typography Style Strategies](https://carbondesignsystem.com/elements/typography/style-strategies)
  - Carbon separates productive and expressive type styles.
  - Productive styles fit task-oriented interfaces, while expressive styles fit editorial pages.
  - A page can blend the two sets to make functional regions recede and user-interest regions stand out.
- [Carbon Typography Type Sets](https://carbondesignsystem.com/elements/typography/type-sets/)
  - Type tokens help manage typography across layered layouts and patterns.
  - Carbon recommends keeping type styles consistent within a discrete task, component, or region.
- [MDN `text-wrap`](https://developer.mozilla.org/en-US/docs/Web/CSS/text-wrap)
  - `text-wrap: balance` is intended for short blocks such as headings, captions, and blockquotes.
  - The goal is better line balance and legibility, not wholesale changes to content hierarchy.
- [MDN Container Queries](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_container_queries)
  - Component-level layout can respond to the width of a container rather than the viewport.
  - Container queries are a better fit than viewport breakpoints when hierarchy changes at the card, pane, or sidebar level.
- [Nielsen Norman Group Visual Design Principles](https://media.nngroup.com/media/articles/attachments/Principles_Visual_Design-Letter.pdf)
  - Visual hierarchy guides the eye in order of importance.
  - Scale, contrast, balance, and Gestalt grouping do most of the work.
  - Use a small number of size steps so the page stays scannable.
- [MDN CSS Grid Layout](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Grid_layout)
  - Grid is a good fit for dividing a page into major regions.
  - It keeps the relationship between parts of a control explicit.

## Practical Implications

- Use one dominant `h1` for the page title and make subordinate sections follow a clear rank order.
- Treat the page header as part of the hierarchy system: title first, then breadcrumbs or search/filter controls only when they improve orientation. See the page-header orientation note for placement details.
- Keep sidebar headings stable across views instead of reshaping them to match the content pane.
- Prefer labels, spacing, and proximity over decorative separators to show relationships.
- Use the grid or column system to divide major regions before adding extra visual ornament.
- Constrain long-form content to readable measures instead of letting wide columns carry the entire page.
- Make repeated shell regions and sidebars identifiable with landmarks plus visible labels.
- Keep productive task surfaces internally consistent; reserve more expressive type treatment for editorial or overview surfaces.
- Reserve `text-wrap: balance` for short headings and other short blocks where line shape matters more than exact wrapping.
- Use container queries when a pane, card, or sidebar needs its own hierarchy breakpoints.
- Design dense control rows with enough hit area and spacing that grouping stays clear at 200% zoom.

## Follow-Up

- Compare the repo's actual page headers, breadcrumbs, search, and filter affordances against this hierarchy model.
- Use the page-header orientation note to decide whether breadcrumbs belong on a given page at all.
- Check whether any dense-tool pages need a stricter maximum number of emphasis levels or a clearer split between productive and expressive typography.
- Decide whether this guidance should eventually become a principle about scannability and layout rhythm.
- See the responsive typography and container-aware layout note for the CSS primitives that support this hierarchy.
