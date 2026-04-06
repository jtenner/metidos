# Search, Filtering, and Progressive Disclosure

Date: 2026-04-06

This research pass focused on practical search and filtering behavior in dense workspaces, especially how to keep search discoverable, how to scope it cleanly, and how to hide secondary filters without making them hard to find.

## Summary

The strongest current guidance is to treat search as a first-class landmark, not just an input, and to keep advanced narrowing controls behind progressive disclosure. A search surface should be obvious, well-labeled, and scoped to the content it actually affects. Secondary filters should stay close to the results they shape, and hidden options should still preserve the user's sense of state once they are expanded.

## Source Notes

- [MDN `<search>` element](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/search)
  - The `<search>` element represents search or filtering controls.
  - It is not for search results; those belong in the main content.
  - It provides native HTML semantics for search-related controls.
- [MDN `<input type="search">`](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/search)
  - Search inputs are intended for query entry.
  - `<input type="search">` is for the query field, not the landmark itself.
  - If the search UI sits inside a `<form>`, `role="search"` can be added to the form as an alternative landmark.
- [MDN ARIA `search` role](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/search_role)
  - The `search` role identifies the section used to search a page, site, or collection.
  - Multiple search landmarks should be uniquely labeled unless they are repeated versions of the same search.
  - The search landmark should wrap the whole search feature, not just the input.
- [W3C ARIA Search Landmark example](https://www.w3.org/WAI/content-assets/wai-aria-practices/patterns/landmarks/examples/search.html)
  - `role="search"` defines a search landmark.
  - A page with multiple search landmarks should give each one a unique label.
  - Search landmarks support quick navigation for screen reader users.
- [MDN `<details>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/details)
  - `<details>` creates a disclosure widget that is hidden until expanded.
  - The `<summary>` element provides the label for the disclosure.
  - It is a good fit for secondary controls such as advanced filters or optional refinements.
  - There is no built-in transition between open and closed states, which keeps the control honest about its state change.
- [W3C Landmark Regions](https://www.w3.org/WAI/ARIA/apg/practices/landmark-regions/)
  - Landmarks should be labeled when there is more than one of the same type.
  - Landmarks help users jump between major regions, but they do not replace visible page structure.
- [Nielsen Norman Group, Mobile Intranets and Enterprise Apps](https://media.nngroup.com/media/reports/free/Mobile_Intranets_and_Enterprise_Apps.pdf)
  - Progressive disclosure helps guide users through dense enterprise content.
  - Breaking complexity into stages makes large information spaces easier to scan.

## Practical Implications

- Use one obvious search surface per scope.
- Label each search landmark uniquely when more than one search exists on a page.
- Keep search controls adjacent to the results they affect.
- Hide secondary filters behind disclosure when they are useful but not always needed.
- Preserve selected filters visually so users can recover their state after expanding or collapsing controls.
- Prefer shallow, staged narrowing over deep nested filter trees.
- Treat the result set and the active filter state as one interaction, not two unrelated widgets.

## Follow-Up

- Decide whether the repo should standardize search/filter behavior in a reusable pattern note.
- Verify whether the app needs one global search landmark or several scoped search landmarks.
- Compare advanced filter disclosure against the repo's current sidebar and panel behaviors.
