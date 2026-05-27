# UI Style Guide

This is the canonical UI guide for `src/mainview/`. It should stay compact, enforceable, and specific.

## Product stance

Metidos should feel like:

- a serious desktop tool
- text-first
- dense but readable
- calm, technical, and consistent
- dark by default
- structurally precise, not decorative

It should not feel like:

- a marketing site
- a generic Tailwind demo
- a dashboard of tiles
- a glassy SaaS template
- a pile of independently styled components

## Non-negotiables

### No cards

**Do not add new card UI.**

That means no detached dashboard tiles, oversized rounded boxes, decorative panel blocks, or padded/shadowed mini-surfaces used where a row, section, split panel, inset region, popover, or dialog would do.

Preferred patterns:

- list rows
- sidebar sections
- split panels
- inline grouped controls
- inspectors
- popovers
- dialogs
- inset code/diff regions
- subtle bordered sections inside an existing panel

### No local mini design systems

Do not invent component-local color palettes, spacing systems, badge styles, shadow recipes, or typography scales. Reuse shared tokens and shared primitives.

### Density is a feature

Do not expand spacing or padding to create artificial importance. Keep the UI compact and operational.

## Design rules

1. **Structure before decoration.** Hierarchy should come from layout, headings, spacing, and grouping before color or effects.
2. **One app, one palette.** Use semantic tokens, not one-off hex values.
3. **Lists over boxes.** Most Metidos surfaces are rows, panels, logs, and inspectors, not cards.
4. **Accent is functional.** Use accent color for focus, selection, active controls, and important metadata — not large decorative fills.
5. **Quiet motion.** Animation should clarify state change, never dramatize it.
6. **Low surface count.** Favor a few coherent regions over many nested containers.

## Canonical visual system

Centralize visual tokens in `src/mainview/input.css` and expose them through semantic utilities.

### Surface layers

Use a small stable set of surfaces only:

- app background
- main canvas
- surface 1
- surface 2
- overlay surface

If a component needs more separation, first try:

- border
- spacing
- typography
- section headers

before inventing a new fill color.

### Token families

Maintain semantic tokens for:

- backgrounds and surfaces
- borders
- primary/secondary/muted/faint text
- accent and focus ring
- danger/warning/success states
- shadows
- radii

Do not add arbitrary values to class strings when a shared token should exist instead.

## Typography

### Fonts

- UI text: `Inter`
- code, diffs, hashes, paths, commands: `Fira Code`

### Approved type scale

- `10px` — micro labels only
- `11px` — dense metadata and pills
- `12px` — secondary metadata, compact controls
- `13px` — default compact control text
- `14px` — default body text and row titles
- `16px` — section emphasis only

Do not introduce new `9px` text except to preserve an existing constrained case.

### Weights

- 400 — body
- 500 — standard emphasis
- 600 — row titles
- 700 — section titles
- 800 — markdown headings only

### Label treatment

Uppercase labels are allowed only for small metadata and section eyebrows. Use one consistent letter-spacing treatment rather than ad hoc tracking values.

## Spacing and sizing

### Grid

Use a 4px spacing grid. Common spacings should be:

- 4
- 8
- 12
- 16
- 20
- 24

### Standard control heights

- small icon button: `28px`
- standard input/button: `32px`
- prominent input/button: `36px`
- compact row min height: `36px`
- standard list row min height: `44px`

### Standard padding recipes

- compact inline control: `px-2 py-1`
- standard input/select/button: `px-3 py-2`
- compact panel header: `px-3 py-2.5`
- panel section body: `p-3` or `p-4`

## Borders, radii, shadows

### Borders first

Use borders as the primary separation mechanism. The app should feel crisp, not fluffy.

### Radius

Keep radii tight:

- rows and inline controls: square or barely rounded
- popovers and dialogs: small to medium radius
- avoid large pillowy radii on desktop surfaces

### Shadows

Allowed:

- popovers
- dialogs
- floating overlays

Not allowed:

- sidebar rows
- normal panels
- static section containers pretending to be cards

### Blur

Backdrop blur is only for true floating overlays. Do not blur ordinary panels.

## Layout patterns

### Sidebar

The sidebar is a tool rail. It should use compact rows, simple headers, and continuous sections.

Do not stack boxed mini-panels in the sidebar.

### Workspace

Workspace views should prefer:

- clear headers
- continuous scroll regions
- section dividers
- inline notices
- split panels for side-by-side related content

Do not break a workspace into many detached containers.

## Shared component rules

### Section headers

Use one shared section-header pattern with:

- title
- optional status/count text
- optional action slot
- consistent spacing and typography

### Rows

Rows are the core unit for threads, projects, worktrees, history, settings, and search results.

Rows should have:

- subtle hover state
- clear selected state
- compact metadata
- restrained borders/backgrounds

Selection should be shown with an accent tint, accent text, or a slim accent bar — not a completely different visual language.

### Inputs and composer

Inputs, search fields, and textareas should share:

- border family
- background family
- text colors
- focus ring
- sizing rules

Desktop and mobile variants may differ in layout, but should still feel like the same product.

### Buttons

Use shared primitives from `src/mainview/controls/button.tsx` for interactive button surfaces: `AppButton` for app actions, `IconButton` for icon-only actions, `TabButton` for view tabs, `ListOptionButton` for popover/listbox choices, and `NotificationButton` for dismissible notifications. Standard action buttons share one height (`32px`), the same focus/hover/disabled behavior, and exactly four visual styles:

- `primary` — white primary action
- `secondary` — gray standard action
- `muted` — darker/quiet secondary action
- `error` — red stop/destructive action with an explicit hover state

Do not hand-style random one-off button recipes, add component-local button variants, or reintroduce legacy button utility classes. If a button needs a new treatment, extend the shared primitive and update this section.

### Badges

Badges are small semantic markers for status or short flags. They are not layout containers.

### Status icons

Compact status icons are square markers, not rounded dots or circles. Use the shared `StatusIcon` primitive from `src/mainview/controls/status-icon.tsx` for small status markers. Its tones are limited to the Metidos semantic state colors: `success`, `warning`, `danger`, `info`, and `neutral`. Do not introduce component-local status icon colors or rounded status dots.

### Popovers, dialogs, tooltips

Floating surfaces should share one overlay language:

- same overlay background family
- same border family
- same shadow family
- same radius family
- same type scale

### Notices

Errors, warnings, informational notes, and empty states should use compact shared patterns. They should read like operational UI, not promotional callouts.

### Messages, diffs, and code

The transcript is a reading surface. Message rendering should stay text-first and consistent across:

- plain text
- markdown
- tool output
- errors/notices
- code blocks
- diffs

Diffs and code should be monospaced, restrained, high-contrast, and functional.

## Interaction rules

### Hover

Hover should be subtle: slight background lift, text emphasis, or border emphasis. No dramatic transforms.

### Pressed

Pressed states should be immediate and quiet.

### Focus

All interactive controls must use a clear shared keyboard focus treatment.

### Disabled

Disabled controls should lower contrast and remove ambiguity without becoming unreadable.

## Accessibility rules

- Keep primary text high-contrast.
- Keep muted text readable on real displays.
- Maintain usable target sizes even in dense layouts.
- Use icons to support labels, not replace clarity.

## Implementation priorities

When touching high-noise styling, prioritize these files:

1. `src/mainview/app/message-ui.tsx`
2. `src/mainview/app/thread-list-row.tsx`
3. `src/mainview/controls/chat-composer-control.tsx`
4. `src/mainview/app/desktop-thread-switcher.tsx`
5. `src/mainview/app/git-history-panel.tsx`
6. `src/mainview/app/threads-panel.tsx`
7. `src/mainview/app/pinned-threads-panel.tsx`
8. `src/mainview/app/desktop-sidebar.tsx`
9. `src/mainview/controls/sidebar-search-control.tsx`
10. `src/mainview/controls/thread-access-control.tsx`

## Review checklist

Reject UI changes that:

- add new card layouts
- add fresh one-off hex values instead of tokens
- add decorative shadows to static surfaces
- introduce unrelated spacing systems
- branch desktop/mobile into unrelated visual languages
- invent new badge, banner, or input recipes without a shared primitive

Mechanical checks:

- `bun run style:check` warns on raw hex colors in `src/mainview/` outside token/test files and native `<button>` usage outside approved primitives.
- `bun run style:check:strict` fails on those same findings once existing drift is migrated.

Before merging UI work, confirm:

- tokens were reused or improved
- typography stays on the approved scale
- spacing stays on the 4px grid
- hover/focus/disabled behavior is consistent
- status colors are semantic, not decorative
- status icons use the shared square marker treatment and Metidos semantic tones
- the result looks like one coherent desktop tool
