# Form Validation Pattern

Use this pattern for dialogs, side panels, inline editors, and full-page forms that need a consistent way to collect input and show validation feedback.

## When to Use

- The user must submit structured data.
- The form has more than one field or includes grouped options.
- Validation failures should be recoverable without leaving the current surface.

## Structure

- Use native form controls first.
- Give every control a visible label.
- Associate labels explicitly with `for` and `id` unless there is a strong reason not to.
- Group radios and checkboxes in `<fieldset>` with a `<legend>`.
- Keep helper text and error text adjacent to the field they describe.
- Use `aria-describedby` for helper text and `aria-errormessage` for visible error text when both are needed.
- Mark invalid fields with `aria-invalid="true"` only after validation fails.
- If the form uses custom validation UI, add `novalidate` so browser bubbles do not compete with your error summary.
- Keep a live region container in the DOM before it is needed when errors or status updates must be announced.

## Validation Behavior

- Validate on submission by default.
- Prefer blur-time validation only for fields with simple local rules that benefit from early feedback.
- For submit-time validation, keep the user's entered values in place.
- Show inline error text next to the field and an error summary when there are multiple problems or the first error may be offscreen.
- Keep the summary copy identical to the inline field copy and link each summary item to its field.
- Move focus to the summary after a failed submit when one is present; otherwise move focus to the first invalid field.
- Keep the error message specific about what is wrong and what to do next.
- Use `role="alert"` for urgent validation failures that need immediate attention.
- Use `role="status"` for non-urgent confirmations or progress updates.
- When custom validation is in charge, prefer a single announcement path instead of mixing native browser messages with custom summaries.
- Do not mark empty required fields invalid before the user tries to submit the form.

## Controls

- Use `<button>` for actions and `<a>` for navigation.
- Make button text explicit, especially for icon buttons.
- Keep the default focus ring unless there is a well-tested replacement.
- Ensure click and touch targets are large enough to hit comfortably, ideally at least 24 by 24 CSS pixels or with equivalent spacing.

## Avoid

- Hiding validation only in color.
- Using placeholder text as the only label.
- Disabling submit before the user can see why the form is blocked.
- Wrapping unrelated inputs in one generic group label.
- Replacing native controls with custom `div`-based widgets unless the native element cannot express the interaction.
- Reusing one helper string for both instructions and errors.
- Clearing the user's entered values when validation fails.
- Mixing native browser error bubbles with a custom summary and inline error pattern.

## Related Research

- [Accessible Forms, Controls, and Affordances](../research/2026-04-06-accessible-forms-controls-and-affordances.md)
- [Form Error Summary Focus Management](../research/2026-04-06-form-error-summary-focus-management.md)
- [Loading, Empty, and Error Feedback States](../research/2026-04-06-loading-empty-error-feedback-states.md)
