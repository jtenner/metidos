# Responsive Typography and Container-Aware Layout

Date: 2026-04-06

This research pass focused on the CSS primitives that keep dense workspace UIs readable as panes narrow, cards reflow, and headings wrap. The goal was to separate implementation details from the broader information-hierarchy guidance so the docs tree can answer two different questions cleanly: how to structure the page, and how to make the structure adapt.

## Summary

Current practice favors bounded fluid values over hard jumps, and component-local breakpoints over viewport-only assumptions. `clamp()` is a practical way to keep type and spacing fluid without letting them grow out of control. `text-wrap: balance` is useful for short headings and captions when a bad line break harms scanability. Container queries let a component respond to the width of the thing it lives in, which is a better fit than viewport breakpoints for panes, cards, and nested workspace regions. `subgrid` is the alignment tool to reach for when repeated internals need to stay lined up with a parent grid instead of drifting on their own nested layout.

## Source Notes

- [MDN CSS media queries](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_media_queries)
  - Media queries remain the baseline tool for responsive design.
  - Breakpoints should still be driven by content needs, not device labels.
- [MDN `clamp()`](https://developer.mozilla.org/en-US/docs/Web/CSS/clamp)
  - `clamp()` bounds a value between a minimum and maximum.
  - It is useful for fluid type scales and spacing tokens because it avoids separate media-query steps.
- [MDN `text-wrap`](https://developer.mozilla.org/en-US/docs/Web/CSS/text-wrap)
  - `balance` improves short blocks such as headings and captions by distributing lines more evenly.
  - The keyword is not a substitute for semantic hierarchy, but it can improve scanability when a short title wraps awkwardly.
- [MDN CSS containment](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_containment)
  - Container queries are part of the containment model.
  - Container query units make lengths relative to the query container.
- [MDN CSS container queries](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_container_queries)
  - Container queries let a child respond to a container instead of the viewport.
  - They are a strong fit when a pane or card has to adapt independently from the page shell.
- [MDN Subgrid](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_grid_layout/Subgrid)
  - `subgrid` lets nested content inherit track sizing from the parent grid.
  - It is useful when labels, values, or card internals need to line up across repeated components.

## Practical Implications

- Use `clamp()` for type scales, spacing tokens, and measured widths when values should grow but stay bounded.
- Keep base page structure simple first, then layer fluid values on top so hierarchy still makes sense at every size.
- Use `text-wrap: balance` on short page titles, section headings, and compact captions where line breaks are hurting readability.
- Avoid using `balance` on long paragraphs or editable text unless you have a specific reason and can verify the result.
- Prefer container queries for panes, cards, and sidebars that should adapt to their own width rather than the whole viewport.
- Keep viewport breakpoints for shell-level transitions, and use container queries for component-level transitions.
- Use `subgrid` when repeated inner content should align with parent columns or rows instead of drifting on an independent nested grid.
- Treat `subgrid` as an alignment tool, not a layout strategy by itself.

## Follow-Up

- Check which pane types in the app should adopt container queries first.
- Compare `text-wrap: balance` against the app's actual heading lengths and localization risk.
- Decide whether any dense card or table internals would benefit from `subgrid` enough to justify the added complexity.
- Revisit which type and spacing tokens should be fluid in the shared design system versus fixed in component-local styles.
