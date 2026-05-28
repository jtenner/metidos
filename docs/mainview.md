# Mainview

Mainview is the browser-first React/Tailwind UI under `src/mainview/`. It renders the local operator experience for projects, worktrees, threads, diffs, cron jobs, settings, plugins, calendars, notifications, and terminal workspaces.

## Source layout

- `src/mainview/app/` — application feature modules, hooks, controllers, state derivation, and workspace components.
- `src/mainview/controls/` — lower-level shared UI controls.
- `src/mainview/input.css` — Tailwind input.
- `src/mainview/index.css` — generated output; do not edit by hand.
- `src/mainview/app/README.md` — detailed module map for the application layer.

## Design-system source of truth

Before UI work, read `STYLE.md`. It is the source of truth for:

- tokens,
- spacing grid,
- typography scale,
- shared primitives,
- button rules,
- no-card rule,
- color and interaction expectations.

Reject changes that work around the style guide by adding one-off visual systems.

## Main application responsibilities

Mainview owns browser-facing composition and UI state, while Backend remains authoritative for durable product state and security decisions.

Mainview responsibilities include:

- navigation between projects, worktrees, threads, and workspaces,
- rendering Thread transcripts and composer controls,
- showing model catalog choices and reasoning effort where supported,
- rendering diff trees and file patches,
- presenting cron job state and cron edit/create dialogs,
- showing plugin inventory, settings, lifecycle actions, review dialogs, ingress bindings, and routes,
- handling Pi extension UI prompts/status/widgets,
- preserving local UI preferences such as sidebar state,
- virtualizing hot lists and large transcripts.

Mainview must not become the authority for path access, plugin approval, provider secrets, or unsafe execution. Those decisions belong to Backend.

## State management pattern

Mainview uses focused React hooks, pure state helpers, and typed RPC calls rather than a broad global state library.

Important patterns:

- Keep hot collection updates in focused stores such as project/thread helpers.
- Put expensive derived projections behind memoized selectors.
- Extract broad async orchestration into dedicated controllers instead of expanding `App.tsx`.
- Keep pure decision helpers exported and covered by focused tests.
- Use Backend invalidation/push events to refresh specific slices instead of polling everything.

Examples:

- `use-mainview-shell-controller.ts` owns shell selection and navigation state.
- `use-mainview-startup-controller.ts` owns startup restore.
- `use-project-worktree-controller.ts` owns project/worktree orchestration.
- `use-thread-workspace-selection-controller.ts` owns thread opening and cross-context start requests.
- `use-thread-status-controller.ts` owns status polling and selected-thread refresh.
- `use-git-history-controller.ts` owns git-history pagination and commit-diff modal loading.
- `mainview-cron-workspace-controller.tsx` owns cron workspace lifecycle state.

## RPC usage

Mainview communicates with Backend over typed WebSocket RPC. UI code should:

- use schema-backed request and response types,
- handle loading, empty, error, and stale states,
- cancel or ignore obsolete requests when selections change,
- use backend-supplied status and invalidation signals,
- avoid leaking raw local paths or secrets into generic error displays.

See [RPC](./rpc.md).

## Diff and transcript performance

Large diffs and huge messages can make the browser slow if handled synchronously. Mainview includes worker-backed and cached paths for:

- diff parsing and summary counts,
- markdown/message preprocessing,
- transcript row-state projection,
- visible message virtualization,
- cached row-height reuse.

When adding transcript or diff features, preserve these seams instead of putting heavy parsing directly in render paths.

## Accessibility and interaction expectations

UI changes should preserve:

- native semantics for buttons, links, dialogs, menus, and form controls,
- keyboard access,
- visible focus states,
- readable labels and error messages,
- status feedback that is not color-only,
- predictable mobile and desktop layouts.

Use semantic HTML before ARIA. Custom interactive elements need roles, states, labels, and keyboard behavior matching user expectations.

## Local UI development workflow

```bash
bun install --frozen-lockfile
bun run dev
```

Useful checks:

```bash
bun run tailwind:build
bun run style:check
bun run typecheck
bun test src/mainview
bun run validate
```

Use `bun run style:check:strict` when tightening style-guide compliance.

## UI change checklist

- [ ] Read `STYLE.md` and reuse existing primitives.
- [ ] Confirm terminology matches `UBIQUITOUS_LANGUAGE.md`.
- [ ] Keep security decisions on Backend.
- [ ] Add or update focused tests for extracted helpers and controllers.
- [ ] Check loading, empty, error, and stale states.
- [ ] Test keyboard paths and dialog focus behavior.
- [ ] Include screenshots only with fake/demo data and no usernames, hostnames, secrets, internal repos, private paths, or customer/user data.
