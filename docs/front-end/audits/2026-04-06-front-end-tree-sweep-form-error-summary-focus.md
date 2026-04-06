# Front-end Tree Sweep: Form Error Summary Focus

Date: 2026-04-06

## What Changed

- Added a focused research note for form error summary focus management and announcement behavior.
- Kept the broader accessible forms note as the landing page for labels, grouping, affordances, and validation basics.
- Linked the form validation pattern to the focused research note so the implementation guidance and source notes stay aligned.
- Updated the front-end index, goals, and repo tree to reflect the new note.

## Why

- The validation guidance was starting to stretch across the broader forms note and the feedback-state notes.
- Focus management for failed validation is specific enough to deserve its own source-backed note.
- The new split keeps the tree easier to scan without creating duplicate pattern files.

## Follow-Up

- Recheck the app’s form surfaces against the new summary-and-focus guidance.
- Revisit `:user-invalid` styling after browser support is confirmed for the surfaces that need it.
