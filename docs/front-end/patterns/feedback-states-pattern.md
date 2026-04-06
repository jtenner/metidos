# Feedback States Pattern

Use this pattern for tables, panels, result sets, and detail surfaces that need loading, empty, or error feedback.

## When to Use

- Content may take time to arrive.
- A region can be empty for legitimate reasons.
- The user needs a clear explanation when data cannot be shown or an action fails.

## Structure

- Use skeletons when a page or large panel can reveal structure before data arrives.
- Use progressive loading when content can arrive in batches.
- Use inline loading for a single action or component that is processing.
- Replace missing content with an empty state in the same space.
- Keep empty-state copy contextual, short, and action-oriented.
- Use a polite status region for non-urgent updates.
- Use `role="alert"` for urgent, dynamically generated error messages.
- Set `aria-busy` while a related section is still updating.

## Behavior

- Match the indicator to the scope of the wait.
- Keep loading states local to the area that is actually blocked.
- Preserve the user’s context while data is loading or a submission is in flight.
- Give empty states one clear next step whenever possible.
- If multiple regions can be empty at once, avoid multiple competing primary actions.
- Make error copy explain what happened and what the user can do next.
- Keep assistive-technology announcements proportional to urgency.

## Avoid

- Full-page spinners for content that could load progressively.
- Skeletons for controls the user needs to click immediately.
- Empty states that sit beside the missing content instead of replacing it.
- Generic error text that does not explain the next step.
- Multiple loading indicators for the same operation.
- Using `role="alert"` for routine status updates.

## Related Research

- [Loading, Empty, and Error Feedback States](../research/2026-04-06-loading-empty-error-feedback-states.md)
- [Form Error Summary Focus Management](../research/2026-04-06-form-error-summary-focus-management.md)
- [Dense Workspace Hierarchy, Navigation, and Feedback States](../research/2026-04-06-dense-workspace-hierarchy-navigation-feedback.md)
