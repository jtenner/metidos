# Form Error Summary Focus Management

Date: 2026-04-06

This research pass focused on how web forms should surface validation failures without forcing users to hunt for the problem. The main question was whether a failed submit should move focus to a summary, to the first invalid field, or to both in different layouts.

## Summary

When a form fails validation, the current guidance favors a top-of-surface error summary when there are multiple errors or when the first problem may be offscreen. The summary should use the same wording as the inline errors, point to the affected fields, and take focus so keyboard and screen reader users land on the failure immediately. If the surface is small enough that a summary adds noise, moving focus to the first invalid field is acceptable. Native HTML validation still tends to move focus to the first invalid control, but custom validation gets better control over wording, layout, and announcement behavior.

## Source Notes

- [W3C Design System: Forms: validation](https://design-system.w3.org/styles/form-validation.html)
  - Validate on submission by default.
  - Turn off native HTML5 validation when custom validation messaging is used.
- [W3C Design System: Forms: errors](https://design-system.w3.org/styles/form-errors.html)
  - The example error summary is rendered with `role="alert"` and `tabindex="-1"`.
  - Summary items link directly to the fields that need attention.
- [GOV.UK Design System: Error summary](https://design-system.service.gov.uk/components/error-summary/)
  - Show an error summary when there is a validation error.
  - Move focus to the summary after a failed submission.
- [W3C WCAG 2.1 Understanding SC 3.3.1 Error Identification](https://www.w3.org/WAI/WCAG21/Understanding/error-identification)
  - Error identification may be inline, in a summary, in an alert, or in a dialog.
  - Native browser validation often focuses the first invalid field, but custom validation can provide clearer and more specific feedback.
- [MDN `aria-invalid`](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-invalid)
  - Mark controls invalid only when they actually fail validation.
- [MDN `aria-errormessage`](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-errormessage)
  - Use visible error text and connect it to the invalid field.
  - Pair it with `aria-invalid="true"` when the field is in error.
- [MDN `alert` role](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/alert_role)
  - `alert` is for important, usually time-sensitive information.
  - It is meant for dynamic updates, not static page content.
- [MDN `status` role](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Roles/status_role)
  - `status` is for advisory information that does not warrant interruption.
- [MDN `aria-busy`](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-busy)
  - Use `aria-busy` when a related section is still being updated so assistive technology waits for the batch to finish.
- [MDN `noValidate`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLFormElement/noValidate)
  - `noValidate` disables the browser's built-in constraint validation on submit.

## Practical Implications

- Use a summary when a failed submit produces multiple errors, when the first invalid field is likely offscreen, or when the surface is large enough that the user needs an orientation point.
- Keep the summary copy identical to the inline field messages so users do not have to reconcile two phrasings of the same problem.
- Put each summary item on the actual field or group that needs attention.
- Move focus to the summary after a failed submit if one is present; otherwise focus the first invalid field.
- Use `tabindex="-1"` or equivalent framework support so the summary can receive programmatic focus without entering the tab order.
- Use custom validation UI consistently if the form owns its own messaging; do not mix browser bubbles with a custom summary.
- Use `role="alert"` for dynamically inserted, urgent error content, and keep routine progress or confirmation messages in `status` regions instead.
- Keep `aria-busy` limited to areas that are genuinely still changing.
- Use `:user-invalid` as a style-only progressive enhancement for post-interaction invalid states where browser support is sufficient, but do not rely on CSS alone for semantics.

## Related Patterns

- [Form Validation Pattern](../patterns/form-validation-pattern.md)
- [Feedback States Pattern](../patterns/feedback-states-pattern.md)

## Follow-Up

- Compare the app’s current failed-submit behavior against the summary-or-first-field rule here.
- Check whether any custom validation surface still depends on native browser bubbles instead of a single summary-and-inline pattern.
- Decide whether `:user-invalid` should become a standard styling hook for this repo.
