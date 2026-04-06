# Information Hierarchy and Visual Structure

Date: 2026-04-06

This research pass focused on how dense web UIs communicate structure before users read every line. The goal was to find implementation-friendly rules for headings, spacing, grouping, and component-level layout that keep workspace pages scannable at desktop and small-screen sizes. The responsive type and container-aware implementation details that support this hierarchy are tracked in a dedicated note.

## Summary

Strong hierarchy comes from semantic structure plus consistent visual rhythm. Use heading ranks to mirror page sections, label page regions when landmarks repeat, and keep line length and type scale under control so the page stays readable when resized or magnified. Within dense layouts, related controls should stay close to the content they affect, and the layout should not depend on tiny visual distinctions to communicate grouping.

## Source Notes

- [WAI Headings](https://www.w3.org/WAI/tutorials/page-structure/headings/)
  - Headings communicate page organization and support in-page navigation.
  - Nest heading ranks in order; avoid skipping levels where possible.
  - Fixed regions like sidebars should keep their own heading structure consistent across pages.
  - Use `aria-labelledby` to associate headings with page regions.
- [WAI Labeling Regions](https://www.w3.org/WAI/tutorials/page-structure/labels/)
  - Distinguish repeated regions of the same type with `aria-labelledby` or `aria-label`.
  - Unique landmarks like `main` do not need extra labels.
- [WAI ARIA11 Landmarks](https://www.w3.org/WAI/WCAG22/Techniques/aria/ARIA11)
  - Landmarks help keyboard and assistive-technology users skip repeated chrome.
  - Landmarks supplement headings and should cover the whole page structure.
  - Multiple landmarks of the same role need clear labels.
- [GOV.UK Headings](https://design-system.service.gov.uk/styles/headings/)
  - Style headings consistently to create a clear content structure.
  - The updated type scale improves legibility on small screens.
  - Sentence case is the default.
  - Long-form pages should use larger heading steps at the top and smaller steps below.
- [GOV.UK Type Scale](https://design-system.service.gov.uk/styles/type-scale/)
  - The type scale creates a consistent vertical rhythm that makes pages easier to scan and read.
  - Relative units help type resize better when zoomed or magnified.
  - Use the existing type scale when creating new components.
- [GOV.UK Layout](https://design-system.service.gov.uk/styles/layout/)
  - Start with a single-column layout on small screens.
  - Two-thirds layouts help keep line length readable on desktop.
  - Avoid assuming devices; design for screen sizes.
- [Material Design Accessibility](https://m1.material.io/usability/accessibility.html)
  - Related items should stay in proximity so users can understand grouping.
  - Scalable text and spacious layouts help magnification and assistive technologies.
  - Visual icons can be small when the touch target is larger.
- [Nielsen Norman Group Visual Design Principles](https://media.nngroup.com/media/articles/attachments/Principles_Visual_Design-Letter.pdf)
  - Visual hierarchy guides the eye in order of importance.
  - Scale and contrast do most of the work; use no more than a few type sizes.
  - Balance and Gestalt grouping matter more than decorative ornament.
- [MDN CSS Grid Layout](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Grid_layout)
  - Grid is a good fit for dividing a page into major regions.
  - It keeps the relationship between parts of a control explicit.

## Practical Implications

- Use one dominant `h1` for the page title and make subordinate sections follow a clear rank order.
- Keep sidebar headings stable across views instead of reshaping them to match the content pane.
- Prefer labels, spacing, and proximity over decorative separators to show relationships.
- Constrain long-form content to readable measures instead of letting wide columns carry the entire page.
- Make repeated shell regions and sidebars identifiable with landmarks plus visible labels.
- Design dense control rows with enough hit area and spacing that grouping stays clear at 200% zoom.

## Follow-Up

- Compare the repo's actual pane titles, breadcrumbs, and section headers against this hierarchy model.
- Check whether any dense-tool pages need a stricter maximum number of emphasis levels.
- Decide whether this guidance should eventually become a principle about scannability and layout rhythm.
- See the responsive typography and container-aware layout note for the CSS primitives that support this hierarchy.
