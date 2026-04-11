# UI Style Guide and Styling Proposal

This document defines the intended visual language for the application UI in `src/mainview/`.
It exists to stop incremental style drift, reduce one-off Tailwind class soup, and make future UI work feel like one product designed by one team.

It is both:

1. A style guide for new UI work.
2. A cleanup proposal for existing UI inconsistencies.

---

## Non-negotiables

**🚫 ABSOLUTELY DO NOT ADD NEW CARDS. NEW CARD UI IS BANNED. 🚫**

**🚫 DO NOT INTRODUCE CARD-BASED LAYOUTS, CARD GRIDS, CARD PANELS, CARD SETTINGS BLOCKS, OR “LITTLE DASHBOARD CARDS.” 🚫**

**🚫 IF YOU ARE ABOUT TO WRAP SOMETHING IN A ROUNDED BOX WITH EXTRA PADDING, A SHADOW, AND A TITLE, STOP. DO NOT DO THAT. 🚫**

This application is a dense tooling interface, not a marketing site, not a dashboard gallery, and not a SaaS landing page.

When a new surface is needed, prefer one of these patterns instead:

- sidebar sections
- list rows
- inline grouped controls
- split panels
- table-like rows
- inspectors
- sheets
- popovers
- dialogs
- inset code/diff regions
- subtle bordered sections inside an existing panel

A “card” in this repository means a standalone boxed block that visually detaches itself from the main layout through some combination of:

- oversized border radius
- isolated shadow
- generous outer margin
- self-contained header/body/footer structure
- dashboard-style tile presentation
- decorative panel treatment where a simple section would do

Existing card-like surfaces should be flattened over time into panel sections or row-based layouts.

---

## Product aesthetic

The application should feel like:

- a serious desktop tool
- text-first
- dense but readable
- calm, not flashy
- dark by default
- structurally precise
- slightly editor-like
- minimally glossy
- operational rather than decorative

The UI should not feel like:

- a template marketplace theme
- a generic Tailwind showcase
- a crypto dashboard
- a glassmorphism experiment
- a collection of independently prompted AI components

The desired tone is:

- restrained
- technical
- focused
- consistent
- quiet

---

## Current inconsistencies to fix

The existing UI already has a promising dark, blue-accented direction, but it is inconsistent in execution.
The main problems visible in `src/mainview/` are below.

### 1. Too many one-off colors

The current code uses many near-duplicate arbitrary colors such as:

- background shades: `#131313`, `#14181b`, `#151515`, `#151b20`, `#181b1e`, `#181f24`, `#1e2123`, `#262626`
- border shades: `#2b2b2b`, `#2f3b43`, `#31404a`, `#333c43`, `#35414a`, `#36424b`
- accent shades: `#7aa5c4`, `#8fb5cd`, `#98b9d0`, `#9fc1da`, `#bdd5e6`
- text shades: `#f2f0ef`, `#d4e4ef`, `#d6e7f2`, `#bfd1dc`, `#8f9aa2`, `#8ca6b9`
- danger shades: `#7a2030`, `#341019`, `#2c1117`, `#ff9db0`, `#ffb1bf`, `#ff8698`

The palette is recognizable, but not standardized.
This makes the app feel assembled rather than designed.

### 2. Similar components use different visual rules

Examples:

- `controls/chat-composer-control.tsx` uses meaningfully different desktop and mobile visual languages instead of being two variants of one component.
- `app/threads-panel.tsx`, `app/pinned-threads-panel.tsx`, and `app/git-history-panel.tsx` repeat related header/status patterns with slightly different values.
- `app/thread-list-row.tsx` and `app/desktop-thread-switcher.tsx` both use floating surfaces and overlays, but with inconsistent borders, shadow recipes, and text colors.
- `app/message-ui.tsx` contains several mini-design systems inside one file.

### 3. Too many arbitrary values in class strings

A high number of components rely on long class strings with inline arbitrary values such as:

- `bg-[#151b20]`
- `border-[#31404a]`
- `text-[#d4e4ef]`
- `shadow-[0_18px_42px_rgba(0,0,0,0.56)]`
- `tracking-[0.18em]`

Arbitrary values are useful, but they should be rare and intentional.
Right now they function as an undocumented design system.

### 4. Typography scale drift

The UI mixes:

- `text-xs`
- `text-sm`
- `text-[9px]`
- `text-[10px]`
- `text-[11px]`
- `text-[12px]`
- `text-[13px]`
- `text-[14px]`

That is too much variation for a UI that is mostly lists, panels, and controls.

### 5. Surface elevation is unclear

Some popovers and panels use:

- blur
- translucent backgrounds
- heavy drop shadows
- glass-like overlays
- opaque panel fills

There is not yet a strict rule for when each elevation style is allowed.

### 6. Repeated patterns are not abstracted

Several UI patterns appear over and over with slightly different styling instead of shared primitives:

- section headers
- muted panel headers
- status banners
- icon buttons
- search inputs
- popovers
- badges
- tool output wrappers

---

## Design principles

Every new UI change should follow these principles.

### 1. Structure first, decoration second

Users should understand hierarchy from layout, spacing, headings, and grouping before they notice borders or colors.

### 2. One app, one palette

A small semantic token set should drive the entire interface.
No component should invent its own local color story.

### 3. Lists over cards

This app mostly manages:

- threads
- messages
- projects
- worktrees
- settings
- history
- diffs

Those domains are list-shaped and panel-shaped.
They are not card-shaped.

### 4. Density is a feature

This is a working tool.
Compact layouts are desirable as long as readability is preserved.
Do not expand spacing or padding to create false importance.

### 5. Accent color is functional

Blue accents should communicate:

- active selection
- focus
- actionable affordances
- important metadata

Accent color is not a decorative fill to apply everywhere.

### 6. Motion should be quiet

Animations should clarify state changes, not dramatize them.
No ornamental motion.
No floaty product-marketing transitions.

### 7. Surface count should stay low

The app should read as a small number of nested surfaces, not a pile of disconnected boxes.

---

## Canonical visual system

The style system should be centralized in `src/mainview/input.css` using semantic variables and Tailwind v4 theme mapping.

### Recommended semantic color tokens

These values are chosen to stay close to the app’s existing direction while removing drift.
They are a proposal, not a final immutable palette.

#### Core neutrals

- `--color-bg-app: #0e0f10`
- `--color-bg-canvas: #111315`
- `--color-surface-1: #15191c`
- `--color-surface-2: #1a1f24`
- `--color-surface-3: #20272d`
- `--color-surface-overlay: rgba(17, 21, 24, 0.96)`

#### Borders

- `--color-border-subtle: #263038`
- `--color-border-default: #2f3b43`
- `--color-border-strong: #3a4a55`

#### Text

- `--color-text-primary: #f2f0ef`
- `--color-text-secondary: #cfdae2`
- `--color-text-muted: #93a1ab`
- `--color-text-faint: #74818a`

#### Accent

- `--color-accent: #8fb5cd`
- `--color-accent-strong: #bdd5e6`
- `--color-accent-emphasis: #7aa5c4`
- `--color-accent-surface: #18222a`
- `--color-focus-ring: #9fc1da`

#### States

- `--color-danger-text: #ffb1bf`
- `--color-danger-border: #7a2030`
- `--color-danger-surface: #2b1118`
- `--color-warning-text: #f2d79b`
- `--color-warning-border: #6d5930`
- `--color-warning-surface: #261f12`
- `--color-success-text: #9fe2b1`
- `--color-success-border: #215233`
- `--color-success-surface: #112118`

#### Effects

- `--shadow-overlay: 0 18px 42px rgba(0, 0, 0, 0.56)`
- `--shadow-subtle: 0 8px 18px rgba(0, 0, 0, 0.28)`
- `--radius-sm: 0px`
- `--radius-md: 4px`
- `--radius-lg: 8px`

### Color usage rules

#### App backgrounds

Use only these layers:

- app background
- primary surface
- raised surface
- overlay surface

Do not invent a new dark shade because one component “looks slightly better” with it.
If a surface needs stronger separation, use border, spacing, or typography before introducing a new fill.

#### Text

Use four text levels only:

1. primary
2. secondary
3. muted
4. state text

Avoid mixing many similar grays and desaturated blues inside one view.

#### Accent color

Use accent only for:

- selected row state
- focus ring
- active icons
- small status emphasis
- key metadata labels
- primary action buttons

Do not use accent as the default background for broad containers.

#### State colors

Danger, warning, and success colors must be reserved for actual state meaning.
They should never be used as aesthetic decoration.

---

## Typography

### Font families

- UI text: `Inter`
- code, paths, hashes, diffs: `Fira Code`

### Type scale

Keep the UI on a small, explicit type scale.

#### Approved UI sizes

- `10px`: micro labels only
- `11px`: dense metadata and pill text
- `12px`: secondary metadata, compact controls
- `13px`: default compact control text
- `14px`: default body text and row titles
- `16px`: section-level emphasis only

Avoid introducing `9px` unless absolutely necessary for an existing compressed label that cannot expand.
New UI work should not introduce fresh `9px` text.

### Weight rules

- 400: body copy
- 500: standard UI emphasis
- 600: row titles, medium emphasis
- 700: section titles, primary callouts
- 800: markdown headings only

### Label rules

Uppercase labels are allowed for:

- section eyebrow labels
- small metadata tags
- pill headers

They should be used consistently:

- `font-label`
- `text-[10px]` or `text-[11px]`
- uppercase
- fixed letter spacing token

Do not freely mix `tracking-widest`, `tracking-[0.16em]`, and `tracking-[0.18em]` in similar elements.
Choose one label spacing token and reuse it.

### Code text

Use monospaced text only for:

- code
- diffs
- commands
- file paths
- hashes
- precise structured values

Do not use mono for generic UI labels.

---

## Spacing and sizing

### Base grid

Use a 4px spacing grid.

Approved common spacings:

- `4px`
- `8px`
- `12px`
- `16px`
- `20px`
- `24px`

Anything else should have a strong reason.

### Common control heights

Standardize common heights:

- small icon button: `28px`
- standard input/button: `32px`
- prominent input/button: `36px`
- compact row minimum: `36px`
- standard list row minimum: `44px`

### Padding rules

Prefer consistent internal padding recipes:

- compact inline control: `px-2 py-1`
- standard input/select/button: `px-3 py-2`
- compact panel header: `px-3 py-2.5`
- panel section body: `p-3` or `p-4`

Do not make every component invent its own spacing signature.

---

## Borders, radii, and shadows

### Borders

Borders should do most of the separation work.
This app should rely more on crisp structure than on fluffy effects.

Default rules:

- ordinary panels: 1px border
- inputs and popovers: 1px border
- selected rows: accent inset indicator or background tint, not thicker borders everywhere

### Radius

Keep radii tight.

- rows and inline controls: square or very slightly rounded
- popovers/dialogs: small to medium radius
- no large pillowy radius on standard desktop surfaces

### Shadows

Shadows are allowed for:

- popovers
- dialogs
- floating overlays

Shadows are not allowed for:

- ordinary sidebar rows
- static section containers
- pseudo-card styling

If a static element needs separation, use border and background, not a shadow.

### Blur and translucency

Use backdrop blur only for true floating overlays.
Do not apply blur to ordinary panels or list containers.

---

## Layout patterns

### App shell

The application should read as a small number of major zones:

- app background
- sidebar/navigation surface
- workspace content surface
- temporary overlays

Those zones should be stable and visually quiet.

### Sidebar

The sidebar should feel like a tool rail, not a dashboard.
Use:

- continuous sections
- simple headers
- compact rows
- restrained icons

Avoid:

- boxed mini-panels stacked inside the sidebar
- decorative gradient fills
- isolated card treatment around every section

### Workspace panels

Workspace content should prefer:

- headers with clear titles and supporting metadata
- continuous scroll regions
- section dividers
- inline status messages

Avoid breaking workspace views into many detached blocks.

### Split views

When two related surfaces must coexist, prefer split panels over nested decorative containers.

---

## Component rules

### Section headers

Section headers should be one shared pattern.
They should define:

- title
- optional count/status text
- optional action slot
- consistent padding
- consistent label styling

They should not have custom local color recipes in each panel.

### Rows

Rows are the core unit of the app.
Use rows for:

- threads
- projects
- worktrees
- history items
- settings options
- search results
- menu items

A row should have:

- clear hover state
- clear selected state
- compact metadata
- no decorative ornamentation

Selected state should be expressed through a restrained tinted background, accent text, or a slim accent bar.
Not through a fully different component style.

### Inputs

All text inputs, search fields, and textareas should share:

- the same border family
- the same background family
- the same text colors
- the same focus ring behavior
- similar height and padding logic

The desktop and mobile composer can differ in layout density, but they should not feel like two unrelated products.

### Buttons

Buttons should fall into explicit families:

1. primary
2. secondary
3. quiet icon
4. danger

Each family should have one approved recipe.
Avoid hand-styling individual buttons in-place.

### Badges and pills

Badges should be small, sparse, and semantic.
They should not become a substitute for layout.

Use badges for:

- status
- short flags
- environment or mode labels

Do not use badges as mini-cards.

### Popovers and tooltips

All floating surfaces should share:

- one overlay background token
- one border family
- one shadow token
- one radius token
- one typography scale

Tooltips and popovers should not each define their own shadow and blur recipe.

### Dialogs

Dialogs should be slightly more spacious than panels, but still follow the same palette.
Dialogs are not an excuse to switch to a softer or more decorative style.

### Banners and inline notices

Use a standard pattern for:

- errors
- warnings
- informational notes
- empty states

These should be readable and compact.
They should not look like promotional callouts.

### Message rendering

Messages should remain text-first.
The transcript is a reading surface, not a set of social media bubbles.

Use consistent wrappers for:

- plain text messages
- markdown blocks
- tool call output
- errors and notices
- diff and code output

`message-ui.tsx` should eventually be decomposed into smaller styled primitives.

### Diffs and code blocks

Diffs and code regions should be:

- monospaced
- restrained
- high contrast
- functional

Avoid decorative borders, flashy fills, or excessive radius.

---

## Interaction styling

### Hover

Hover states should be subtle.
Typical hover changes should involve one or two of:

- slightly lighter background
- slightly stronger text
- border emphasis

Do not add dramatic hover transforms to ordinary controls.

### Active/pressed

Pressed states should be immediate and quiet.
A very small scale or contrast change is enough.

### Focus

All interactive controls must have a clear keyboard focus treatment.
That focus treatment should come from one focus token, not many different local colors.

### Disabled

Disabled state should reduce contrast and interactivity clearly, without making text unreadable.

---

## Accessibility and readability

### Contrast

Primary text must remain high-contrast against surfaces.
Muted text must still be readable on standard displays.
Do not rely on ultra-low-contrast gray-on-dark styling.

### Target size

Desktop density is good, but click targets still need to be reasonable.
Very small icon-only actions should be limited and intentional.

### Icon usage

Icons should support text, not replace it where clarity matters.
If an action would be ambiguous from icon alone, add a label or tooltip.

---

## What to do in the codebase

### 1. Centralize tokens in `src/mainview/input.css`

Add semantic variables for:

- backgrounds
- surfaces
- borders
- text
- accents
- state colors
- shadows
- radii
- focus

Then expose them through Tailwind v4 theme utilities or reusable custom classes.

### 2. Replace arbitrary values in high-churn files first

Priority cleanup targets:

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

### 3. Extract shared UI primitives

Create or strengthen shared primitives for:

- section headers
- panel headers
- notice banners
- icon buttons
- text inputs
- popovers
- badges
- row shells

### 4. Reduce visual branching inside single components

If desktop and mobile variants differ, they should still use the same:

- token palette
- typography rules
- button families
- focus rules
- border rules

### 5. Enforce rules in review

Reviewers should reject UI changes that:

- introduce fresh one-off hex colors
- introduce new card layouts
- introduce decorative shadows on static content
- introduce unrelated spacing systems
- invent new badge or banner recipes without reason

---

## Recommended implementation approach

### Phase 1: tokenization

- define semantic variables in `input.css`
- map them to Tailwind-friendly names
- add a few reusable utility classes for the most repeated patterns

### Phase 2: common primitives

- standardize inputs
- standardize icon buttons
- standardize section headers
- standardize notices
- standardize floating surfaces

### Phase 3: migrate highest-noise files

Start with the files where style drift is most visible:

- `message-ui.tsx`
- `thread-list-row.tsx`
- `chat-composer-control.tsx`

### Phase 4: flatten card-like surfaces

Anything that still reads like a detached card should be converted into:

- a section inside an existing panel
- a list row
- a compact settings block
- a dialog
- a popover

Again:

**🚫 NEW CARDS ARE BANNED. 🚫**

### Phase 5: ongoing discipline

Every new UI change should ask:

- does this reuse an existing surface pattern?
- does this use semantic tokens?
- does this fit the app’s dense tool-like layout?
- is this readable without extra decoration?
- could this be a row or section instead of a card?

---

## Quick checklist for any new UI

Before merging UI work, confirm:

- [ ] no new one-off hex colors were added unless they became tokens
- [ ] no new card pattern was introduced
- [ ] text sizes stay on the approved scale
- [ ] spacing stays on the 4px grid
- [ ] inputs/buttons use shared recipes
- [ ] hover/focus/disabled states are consistent
- [ ] status colors are semantic, not decorative
- [ ] floating surfaces use shared overlay styling
- [ ] the result feels like part of the same application

---

## Short version

This application should look like a compact, coherent, text-first desktop tool.
It should use a single dark palette, a single accent family, tight spacing discipline, reusable panel and row patterns, and very little ornament.

And most importantly:

**🚫 DO NOT ADD NEW CARDS. 🚫**
