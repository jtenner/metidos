---
name: semantic-html-implementation
description: Use when choosing or reviewing HTML structure, native elements, ARIA usage, and semantic markup for accessibility and maintainability.
---

# Semantic HTML Implementation

Use this skill when reviewing code or component output. Focus on using the right HTML elements and minimal ARIA so structure, meaning, and interaction are exposed correctly by default.

## Review Markup Choices

- Identify where generic containers replace available semantic elements
- Check ARIA usage for duplication, misuse, or masking of native behavior
- Review forms, navigation, lists, tables, buttons, and dialogs for proper structure
- Consider maintainability and how semantics affect testing and assistive technology support

## Improve Semantics

- Use native HTML elements that match the intended meaning and behavior
- Add ARIA only where necessary to fill genuine gaps
- Keep structure simple, explicit, and aligned with the visual and interaction model
- Avoid div- and span-heavy implementations that require excessive patching

## Output

- Highlight semantic weaknesses in implementation
- Recommend more robust native or minimal-ARIA alternatives
- Prioritize fixes with strong impact on compatibility and maintainability
