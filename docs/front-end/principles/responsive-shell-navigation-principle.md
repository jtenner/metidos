# Responsive Shell Navigation Principle

Responsive shells should preserve orientation before they preserve chrome.

## Guidance

- Keep one obvious path to the main content at all sizes.
- Collapse secondary navigation before it starts to compete with the page.
- Use temporary navigation surfaces on narrow viewports instead of squeezing a permanent sidebar into an unusable shape.
- Keep repeated shell regions reachable through landmarks and skip links.
- Label repeated navigation regions clearly so shell nav stays distinct from page-scoped navigation.
- Make interaction state explicit with selected styling plus `aria-current` and `aria-expanded`.
- Prefer content-driven breakpoints over device-specific widths.

## Why

- Dense product shells are easier to scan when the user can immediately see where they are and how to move.
- Temporary navigation reduces focus cost on small screens and helps the main workspace stay readable.
- Content-driven breakpoints keep the shell responsive to actual layout pressure instead of a guessed device class.

## Related Research

- [Navigation Landmarks and Sidebar Patterns](../research/2026-04-06-navigation-landmarks-and-sidebar-patterns.md)
- [Responsive Shell and Sidebar Collapse](../research/2026-04-06-responsive-shell-and-sidebar-collapse.md)
