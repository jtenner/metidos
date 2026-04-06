# Validation Timing and `:user-invalid` Styling

Date: 2026-04-06

This research pass focused on when validation should happen and how to style invalid fields after interaction without turning CSS into the only source of truth. The current recommendation is to validate on submission by default, reserve blur-time validation for narrow deterministic checks that genuinely save work, and treat `:user-invalid` as a progressive enhancement for post-interaction styling.

## Summary

The strongest pattern across the current sources is a submit-first validation model. W3C's form validation guidance says to validate on submission and disable native HTML5 bubbles when custom validation owns the messaging. MDN's Constraint Validation API guide distinguishes static validation (`checkValidity()`) from interactive validation (`reportValidity()` or form submission), and MDN's `:user-invalid` pseudo-class only matches after the user has interacted with the control. That makes `:user-invalid` useful for styling after a failed attempt, but not for semantics or user-facing copy.

Inference from those sources: blur-time validation should remain the exception rather than the default, because the web platform guidance is centered on submit-time error handling and keeping validation feedback tied to actual failure states. Blur-time checks are best reserved for small, local rules such as simple format or length checks where early feedback prevents wasted effort.

## Source Notes

- [W3C Design System: Forms: validation](https://design-system.w3.org/styles/form-validation.html)
  - The best practice is to validate a form on submission.
  - If client-side validation is required, the design system recommends turning off native HTML5 form validation with `novalidate`.
- [MDN Constraint Validation API](https://developer.mozilla.org/en-US/docs/Web/HTML/Guides/Constraint_validation)
  - `checkValidity()` performs static validation.
  - `reportValidity()` and form submission perform interactive validation.
  - `novalidate` disables interactive validation on the form.
  - `submit()` bypasses constraint validation entirely.
- [MDN `noValidate`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLFormElement/noValidate)
  - `noValidate` reflects the form's `novalidate` attribute.
  - When it is set, the form bypasses constraint validation when submitted.
- [MDN `:user-invalid`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Selectors/:user-invalid)
  - Baseline availability is listed as 2023.
  - The pseudo-class matches invalid controls only after the user has interacted with them.
  - It is a styling hook, not a replacement for accessible invalid state and messaging.
- [GOV.UK Design System: Error summary](https://design-system.service.gov.uk/components/error-summary/)
  - Error summaries link each problem to the field it belongs to.
  - The component uses an alert pattern and focuses the summary on load.
- [GOV.UK Design System: Error message](https://design-system.service.gov.uk/components/error-message/)
  - Show the error message next to the relevant field and in the error summary.
  - Keep the wording consistent so the user does not have to reconcile two messages.

## Practical Implications

- Validate on submission by default.
- Treat blur-time validation as an exception for narrow, deterministic checks that help the user finish faster.
- Use `:user-invalid` for visual state only, after interaction, and keep the accessible invalid state and error text driven by the DOM and ARIA.
- Keep `novalidate` on forms that own their validation UI so native browser bubbles do not compete with inline messages and summaries.
- If a surface must support older browsers or needs a consistent cross-browser look, pair `:user-invalid` with a JS-managed fallback class rather than depending on CSS alone.
- Keep summary and inline copy aligned when validation fails.

## Related Patterns

- [Form Validation Pattern](../patterns/form-validation-pattern.md)
- [Accessible Forms, Controls, and Affordances](./2026-04-06-accessible-forms-controls-and-affordances.md)
- [Form Error Summary Focus Management](./2026-04-06-form-error-summary-focus-management.md)

## Follow-Up

- Check which shared form controls need a fallback class in addition to `:user-invalid`.
- Compare any existing blur-time validation in the app against the submit-first default and remove cases that do not clearly save user effort.
