# Information Hierarchy and Visual Structure

Date: 2026-04-06

This research pass focused on how dense web UIs communicate structure before users read every line. The goal was to find implementation-friendly rules for headings, spacing, grouping, and component-level layout that keep workspace pages scannable at desktop and small-screen sizes. The responsive type and container-aware implementation details that support this hierarchy are tracked in a dedicated note.

## Summary

Strong hierarchy comes from semantic structure plus consistent visual rhythm. Use heading ranks to mirror page sections, label page regions when landmarks repeat, and keep line length and type scale under control so the page stays readable when resized or magnified. Within dense layouts, related controls should stay close to the content they affect, and the layout should not depend on tiny visual distinctions to communicate grouping. For short headings and captions, `text-wrap: balance` can improve the visual shape of wrapped text without changing the underlying hierarchy.

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
- [GOV.UK Type Scale](https://design-system.service.gov.uk/styles/type-scale/)
  - The type scale creates a consistent vertical rhythm that makes pages easier to scan and read.
  - Relative units help type resize better when zoomed or magnified.
  - Use the existing type scale when creating new components.
- [GOV.UK Layout](https://design-system.service.gov.uk/styles/layout/)
  - Start with a single-column layout on small screens.
  - Two-thirds layouts help keep line length readable on desktop.
  - Avoid assuming devices; design for screen sizes.
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
- Keep sidebar headings stable across views instead of reshaping them to match the content pane.
- Prefer labels, spacing, and proximity over decorative separators to show relationships.
- Constrain long-form content to readable measures instead of letting wide columns carry the entire page.
- Make repeated shell regions and sidebars identifiable with landmarks plus visible labels.
- Reserve `text-wrap: balance` for short headings and other short blocks where line shape matters more than exact wrapping.
- Use container queries when a pane, card, or sidebar needs its own hierarchy breakpoints.
- Design dense control rows with enough hit area and spacing that grouping stays clear at 200% zoom.

## Follow-Up

- Compare the repo's actual pane titles, breadcrumbs, and section headers against this hierarchy model.
- Check whether any dense-tool pages need a stricter maximum number of emphasis levels.
- Decide whether this guidance should eventually become a principle about scannability and layout rhythm.
- See the responsive typography and container-aware layout note for the CSS primitives that support this hierarchy.
