---
name: screen-reader-compatibility
description: Use when evaluating or improving screen reader support, checking announcements, landmarks, labels, reading order, or dynamic updates for blind and low-vision users.
---

# Screen Reader Compatibility

Use this skill when reviewing experiences for screen reader users. Focus on whether the interface is understandable, navigable, and correctly announced in context.

## Review Navigation & Semantics

- Check headings, landmarks, labels, roles, names, and reading order
- Verify interactive elements are discoverable and have meaningful accessible names
- Ensure lists, tables, groups, and regions convey structure appropriately
- Confirm users can move efficiently without excessive verbosity or ambiguity

## Review Dynamic Behavior

- Test announcements for validation messages, status updates, modals, and async changes
- Ensure focus moves intentionally and does not get lost after updates
- Avoid duplicate, missing, or misleading announcements
- Check that state changes are exposed programmatically

## Output

- Describe what a screen reader user would likely experience
- Highlight points of confusion, missing context, or blocked interaction
- Recommend changes that improve both semantics and user flow
