# Front-end Tree Sweep: Validation and Target Size

Date: 2026-04-06

This sweep checked the forms and affordance notes for overlap after the latest research pass.

## What Changed

- Tightened the accessible forms research note with the current validation contract: validate on submit by default, keep helper text separate from error text, use `aria-invalid` after validation, and wire visible error text with `aria-errormessage`.
- Updated the form validation pattern so helper text, inline error text, summary behavior, and live-region behavior are separated cleanly.
- Kept target-size guidance in the forms research note instead of splitting it into a new file, because the guidance is still part of the same controls-and-affordances topic.

## What Stayed Consolidated

- No duplicate validation-pattern file was needed.
- No separate target-size note was needed yet.
- Feedback-state guidance remains in the feedback-state pattern rather than being repeated in the forms pattern.

## Follow-Up

- Verify whether dialogs, side panels, and inline editors should share the same error-summary behavior or use a focused first-invalid field instead.
- Check whether any dense-toolbar controls need explicit spacing exceptions around the 24 by 24 CSS pixel target-size default.
