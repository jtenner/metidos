# Motion and Reduced Motion Guardrails

Date: 2026-04-06

This research pass focused on motion and transitions in web UI, with an emphasis on keeping animation useful, accessible, and easy to suppress when the user prefers less motion.

## Summary

The strongest current guidance is to treat motion as a tool for explaining state changes, not as decoration. Non-essential animation should respect the user's reduced-motion preference, and any transition that remains should be subtle enough that it clarifies change instead of demanding attention. Layout-jarring movement, large-scale panning, and motion that repeats without purpose are the main things to avoid.

## Source Notes

- [MDN `prefers-reduced-motion`](https://developer.mozilla.org/en-US/docs/Web/CSS/%40media/prefers-reduced-motion)
  - The media feature detects whether the user wants to minimize non-essential motion.
  - `@media (prefers-reduced-motion)` is equivalent to `@media (prefers-reduced-motion: reduce)`.
  - Reduced-motion rules with the same specificity but later source order take precedence.
  - The preference can be used to replace motion-based animation with a toned-down alternative.
- [MDN Using media queries for accessibility](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_media_queries/Using_media_queries_for_accessibility)
  - Reduced-motion media queries can provide fewer animations and transitions for users who request it.
  - Reducing or removing motion can also help users on low-end devices or with low battery.
- [W3C Understanding SC 2.3.3: Animation from Interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html)
  - Users should not be harmed or distracted by motion.
  - Non-essential animation triggered by interaction should be avoidable unless it is essential to the function or information being conveyed.
  - The guidance explicitly recommends avoiding unnecessary animation and honoring the reduce-motion feature.
- [W3C Understanding SC 2.2.2: Pause, Stop, Hide](https://www.w3.org/WAI/WCAG21/Understanding/pause-stop-hide.html)
  - Moving or auto-updating content needs a mechanism to stop or hide it unless it is essential.
  - Auto-moving content that starts from general interaction can still create accessibility problems if it is not controllable.

## Practical Implications

- Treat motion as progressive enhancement.
- Keep motion local to the affected surface so users can track what changed.
- Prefer opacity and small transforms over movement that shifts large parts of the layout.
- Gate decorative or non-essential animation behind `prefers-reduced-motion`.
- Avoid using motion as the only cue for selection, success, or error state.
- Keep transitions short and purposeful so the interface still feels immediate.
- Provide a no-motion path for any effect that could distract from reading, editing, or scanning.

## Follow-Up

- Audit the app's current transitions against reduced-motion defaults.
- Decide which animations are essential for comprehension versus decorative.
- Check whether loading, drawer, and panel transitions need separate motion rules.
