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
- Mark invalid fields with `aria-invalid="true"` when custom validation is used.
- Connect error text with `aria-errormessage` or `aria-describedby` so assistive tech can reach it.

## Validation Behavior

- Validate when the field can be meaningfully checked.
- Prefer blur-time validation for fields with local rules.
- For submit-time validation, keep the user's entered values in place.
- Show inline error text next to the field and a summary when the form has multiple problems.
- Move focus to the summary or the first invalid field after a failed submit.
- Keep the error message specific about what is wrong and what to do next.

## Controls

- Use `<button>` for actions and `<a>` for navigation.
- Make button text explicit, especially for icon buttons.
- Keep the default focus ring unless there is a well-tested replacement.
- Ensure click and touch targets are large enough to hit comfortably.

## Avoid

- Hiding validation only in color.
- Using placeholder text as the only label.
- Disabling submit before the user can see why the form is blocked.
- Wrapping unrelated inputs in one generic group label.
- Replacing native controls with custom `div`-based widgets unless the native element cannot express the interaction.

## Related Research

- [Accessible Forms, Controls, and Affordances](../research/2026-04-06-accessible-forms-controls-and-affordances.md)

