# Website plugin page information architecture

This note defines the content structure for the planned static `website/plugins.html` page. It is a pre-implementation outline for the open-source launch website and should stay aligned with [`docs/plugin-system.md`](./plugin-system.md), [`docs/metidos-plugin-authoring-guide.md`](./metidos-plugin-authoring-guide.md), [`docs/metidos-plugin-agents-guide.md`](./metidos-plugin-agents-guide.md), and [`docs/plugin-permissions.md`](./plugin-permissions.md).

## Page goals

- Explain Plugin System v1 as a local, review-first extension system.
- Help a Local Operator understand what must be reviewed before plugin code runs.
- Make the safety model obvious before linking to authoring docs.
- Point authors and operators to existing tracked documentation without inventing new public URLs.
- Avoid private data, screenshots, placeholder hosted URLs, or claims that exceed the current experimental status.

## Primary audience

1. **Local Operators** deciding whether to install, approve, enable, disable, or reset plugins.
2. **Plugin Authors** looking for the first public authoring entry points.
3. **Contributors/Auditors** checking permission boundaries, local data boundaries, and approval expectations.

## Proposed page structure

### 1. Hero: "Plugins are local, review-first extensions"

- One-sentence summary: Metidos plugins are folders installed under App Data, discovered without execution, reviewed by the Local Operator, and only run after approval.
- Primary CTA: `Read plugin docs` -> GitHub link to `docs/plugin-system.md`.
- Secondary CTA: `Build a plugin` -> GitHub link to `docs/plugin-tutorial.md`.
- Status callout: Plugin System v1 is experimental and local-operator-approved; APIs may change before a stable public release.

### 2. Safety model overview

Present as three or four compact columns:

- **Discover first** — Metidos lists plugin folders and reads manifest/runtime summaries before executing plugin code.
- **Review capabilities** — the Local Operator reviews manifest permissions, access groups, settings, env declarations, allowlists, and source changes.
- **Approve current code** — approval is tied to a deterministic review hash; source or manifest changes require review again.
- **Run in bounded contexts** — approved plugins run in sidecars and host APIs enforce declared permissions and allowlists.

### 3. Approval and review flow

Show the lifecycle as a simple ordered list suitable for static HTML:

1. Copy a plugin folder under `APP_DATA/plugins/{plugin_id}/`.
2. Metidos discovers the folder without executing code.
3. Settings -> Plugins surfaces manifest details, review hash, source changes, and declared capabilities.
4. The Local Operator reviews and approves the current hash after step-up authentication when required.
5. Approved code starts in a per-plugin sidecar and registers only declared capabilities.
6. Threads can opt into plugin Access Groups when appropriate.
7. Changes outside excluded runtime paths invalidate approval and require re-review.
8. Disable, reset data, or remove the plugin when no longer trusted or needed.

### 4. Capabilities and permissions

Explain the distinction that must be visible on the page:

- A manifest **Permission** grants a host capability to approved plugin code.
- An **Access Group** controls which plugin tools are visible to selected Threads.
- Access Groups do not grant host APIs by themselves; the manifest still needs matching permissions and allowlists.

List representative capability areas without exhaustive schema detail:

- plugin-scoped storage and logging,
- project file access through explicit allowlists,
- network fetch/websocket allowlists,
- SQLite and vector/embedding storage,
- notification/model provider registration,
- agent tools and prompt injection,
- plugin crons,
- request ingress and reply-to-source behavior,
- reset/garbage-collection callbacks.

CTA: `Permission reference` -> GitHub link to `docs/plugin-permissions.md`.

### 5. Local data boundaries

Summarize what belongs to plugin source vs runtime state:

- Source/review files: `metidos-plugin.json`, `AGENTS.md`, manifest `main`, examples, and seed files.
- Runtime state: `.data/`, `.data-bak-*`, and `.logs/` under the plugin folder.
- Settings and secrets live in Metidos App Data; secret settings are encrypted and should not appear in diagnostics or screenshots.
- Plugin examples and docs must not include real provider credentials, private paths, customer data, or copied runtime state.

### 6. Authoring entry points

Use a link list mirroring the docs page so every link already exists:

- `docs/plugin-tutorial.md` — build, install, approve, and enable a minimal local tool plugin.
- `docs/metidos-plugin-authoring-guide.md` — full authoring and manifest guidance.
- `docs/metidos-plugin-agents-guide.md` — writing plugin-local `AGENTS.md` files.
- `docs/metidos-plugin.schema.json` — manifest schema.
- `docs/examples/plugins/README.md` — copyable examples.
- `.pi/skills/metidos-plugin-authoring/SKILL.md` — repository skill for agent-assisted plugin work.

### 7. Operator checklist

A short checklist section for the page footer/body:

- Install plugins only from sources you trust enough to review.
- Read the manifest, `AGENTS.md`, and changed source before approval.
- Verify every permission and allowlist is necessary.
- Keep access groups narrow and enable them only for threads that need them.
- Re-review after source or manifest changes.
- Disable or remove plugins that are no longer needed.

## Navigation placement

After `website/plugins.html` exists:

- Add a `Plugins` nav link to `website/index.html` near Docs/Getting Started or in the feature/CTA areas.
- Add a `Plugins` nav link to `website/docs.html` because plugins are a core docs category.
- Add `plugins.html` to `website/README.md` in the wired-file list and deploy notes.

## Constraints for implementation

- Use existing `website/styles.css` classes/tokens and the no-framework static page pattern.
- Do not add external images, private screenshots, or hosted canonical/OG placeholders beyond the already tracked website TODOs.
- Link only to existing repository/docs paths until the final public org/repo/docs URLs are confirmed.
- Keep copy consistent with the experimental Plugin System v1 status.
