# Accessible Forms, Controls, and Affordances

Date: 2026-04-06

This research pass focused on practical form design and control affordances for web apps: how to label fields clearly, group related inputs, report errors accessibly, and keep action controls obviously interactive.

## Summary

The current best practice is still to rely on native HTML controls first, because they bring accessible names, keyboard behavior, and platform affordances for free. Explicit labels, field groups, visible help text, visible error text, and sensible touch target sizes matter more than custom widget styling. For custom validation, `aria-invalid` should be set only after validation, helper text should stay separate from error text, and the error message should be wired to the field with `aria-errormessage` when the failure is explicit enough to need a direct announcement.

## Source Notes

- [MDN `<label>`](https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/label)
  - A label is the caption for a form control.
  - Explicit `for`/`id` association is generally recommended for compatibility with assistive technologies and tooling.
  - Clicking the label activates the associated control, which improves usability.
- [W3C APG: Providing Accessible Names and Descriptions](https://www.w3.org/WAI/ARIA/apg/practices/names-and-descriptions/)
  - All focusable interactive elements need an accessible name.
  - Native labels are preferable to ARIA substitutes when a real `<label>` is available.
  - `aria-label` should not replace visible text that users need to understand the control.
- [MDN `<fieldset>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/fieldset)
  - `<fieldset>` groups related controls and `<legend>` provides the caption for the group.
  - This is the native semantic structure for related radio buttons and checkboxes.
- [MDN form structure guide](https://developer.mozilla.org/ms/docs/Learn/Forms/How_to_structure_a_web_form)
  - Related widgets should be grouped with `<fieldset>` and `<legend>`.
  - The legend becomes part of the effective label for controls in the group.
- [MDN `aria-invalid`](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-invalid)
  - Mark invalid controls with `aria-invalid="true"` when custom validation is in play.
  - Pair invalid state with styling and a message that explains what to fix.
- [MDN `aria-describedby`](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-describedby)
  - Use `aria-describedby` for helper text and other plain-text descriptions that add context.
  - Keep descriptions concise; use `aria-details` when the content is more structured.
- [MDN `aria-errormessage`](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-errormessage)
  - Use `aria-errormessage` to point at the visible error text when the control is invalid.
  - Keep the error text visible and specific about what is wrong and how to fix it.
- [MDN live regions](https://developer.mozilla.org/docs/Web/Accessibility/ARIA/Guides/Live_regions)
  - Use `role="alert"` for urgent, dynamically displayed validation errors.
  - Use `role="status"` for non-urgent progress or confirmation.
  - Avoid combining live-region mechanisms in a way that causes duplicate announcements.
- [WCAG 2.2 Understanding SC 2.5.8 Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)
  - Pointer targets should be at least 24 by 24 CSS pixels unless one of the WCAG exceptions applies.
  - Larger targets are still preferred where the UI has room.
- [MDN `<button>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/Button)
  - Buttons are for actions, not navigation.
  - Icon-only buttons need an accessible name.
  - The default focus ring should generally be preserved.
- [W3C APG Link Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/link/)
  - Links are for navigation to a resource.
  - Native `<a href>` remains the preferred implementation.

## Practical Implications

- Prefer native `<input>`, `<select>`, `<textarea>`, `<button>`, `<a>`, `<fieldset>`, and `<legend>` before reaching for ARIA.
- Use explicit `<label for>` associations for all visible form fields.
- Group radios and checkboxes with `<fieldset>` and `<legend>` instead of visually faking a heading.
- Keep help text and error text adjacent to the field they describe and wire it with `aria-describedby` or `aria-errormessage` when needed.
- Mark invalid controls clearly with `aria-invalid`, but do not hide the actual error copy.
- Use an error summary or other top-of-form entry point when a form has multiple failures or the first error may be offscreen.
- Use `<button>` for actions and `<a>` for navigation so the browser can preserve correct keyboard and context-menu behavior.
- Make touch targets large enough to avoid accidental activation, especially for adjacent icon buttons and destructive controls.
- Avoid icon-only controls unless the name is obvious in text or an accessible name is supplied.
- Prefer a 24 by 24 CSS pixel minimum for pointer targets, or enough spacing around smaller targets to satisfy WCAG 2.2 target-size guidance.
- Treat the native validation UI as the default unless the design needs custom messaging, custom timing, or a richer error summary.

## Follow-Up

- Decide whether error summaries should be standardized across dialogs, side panels, and full-page forms.
- Verify whether the repo should treat `aria-describedby` and `aria-errormessage` as the default pairing for custom validation states.
- Compare the recommended target sizes here with the repo's current spacing and density goals.
