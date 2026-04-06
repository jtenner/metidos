# Loading, Empty, and Error Feedback States

Date: 2026-04-06

This research pass focused on how dense web apps should communicate loading, empty, and error feedback without obscuring the user’s work.

## Summary

The current guidance is to match the feedback pattern to the scope of the wait or failure. Use skeletons and progressive loading when a page or large panel can reveal structure early. Use inline loading for a single action in one place. Replace missing content with an empty state that lives in the same space as the absent content. For non-urgent updates, use a polite status region; for urgent dynamic errors, use an alert. When multiple related pieces are still updating, `aria-busy` helps keep assistive technology from announcing partial changes too early.

## Source Notes

- [Carbon loading pattern](https://carbondesignsystem.com/patterns/loading-pattern/)
  - Full-screen loading is appropriate when the whole page or a large section is processing.
  - Inline loading fits a single component or action.
  - Progressive loading can reveal page structure in batches.
  - Skeletons represent the page structure while content is still being gathered.
- [Carbon loading component](https://carbondesignsystem.com/components/loading/style/)
  - The loading indicator has separate large and small variants.
  - Label text is optional and should be short if included.
- [Carbon empty states pattern](https://carbondesignsystem.com/patterns/empty-states-pattern/)
  - Empty states belong in the space where the missing content would normally render.
  - Basic empty states can cover first use, user action confirmation, and error management.
  - Error-management empty states should explain why data is unavailable and what the user can do next.
  - Multiple empty states in one view should avoid competing primary actions.
- [Carbon search pattern](https://carbondesignsystem.com/patterns/search-pattern/)
  - No-results search states should suggest a follow-up action.
  - Loading copy should reflect that the search is still running.
  - Search results should include counts, even when there are no results.
- [MDN `aria-busy`](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-busy)
  - `aria-busy` tells assistive technologies that an element is still changing.
  - It can delay announcements until a batch of updates is complete.
  - Set it back to `false` when the update is finished.
- [MDN `status` role](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/status_role)
  - `status` is for advisory updates that are not urgent enough for an alert.
  - It should not take focus when it updates.
  - The implicit live-region behavior is polite and atomic.
- [MDN `alert` role](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/alert_role)
  - `alert` is for important, usually time-sensitive updates.
  - It should be used sparingly and only for dynamically displayed content.
  - Less urgent changes should use a less aggressive live-region pattern.
- [MDN live regions](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Guides/Live_regions)
  - Live-region attributes need to be present before the content changes.
  - `role="alert"` is intended for dynamic updates, not static page-load content.

## Practical Implications

- Use skeletons for initial loads when the page can communicate structure before data arrives.
- Prefer progressive loading over a blocking spinner when the page can reveal useful content in stages.
- Use inline loading when a single control or card is processing and the rest of the interface should remain usable.
- Replace the missing content area with an empty state instead of layering a message on top of the existing structure.
- Keep empty-state copy short, contextual, and action-oriented.
- Use a polite status region for non-blocking progress or confirmation messages.
- Use `role="alert"` only when the user needs immediate attention, such as a dynamic error that changes the next step.
- Set `aria-busy` while a related group of updates is still incomplete, then clear it once the batch is ready.
- Avoid multiple loading indicators or multiple competing primary actions in the same empty or error state.

## Related Patterns

- [Feedback States Pattern](../patterns/feedback-states-pattern.md)

## Follow-Up

- Verify whether the app uses loading, empty, and error feedback consistently across tables, panels, and detail views.
- Compare the app’s current live-region behavior against the `status`, `alert`, and `aria-busy` guidance here.
- Compare validation-summary handling against [Form Error Summary Focus Management](./2026-04-06-form-error-summary-focus-management.md) so the alert and focus behavior stay consistent.
