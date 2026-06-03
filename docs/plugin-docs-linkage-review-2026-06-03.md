# Plugin docs linkage review — 2026-06-03

## Scope

This review verifies the final pre-public checklist item: plugin docs are present and linked from the README.

## Findings

- `README.md` introduces Plugins in the product summary, core concepts, safety model, and repository map.
- `README.md` links directly to `docs/plugin-system.md` from the top-level documentation list.
- `docs/README.md` links plugin docs from the configuration and safety section and specialist-reference section:
  - `docs/plugin-system.md`
  - `docs/plugin-tutorial.md`
  - `docs/metidos-plugin-authoring-guide.md`
  - `docs/metidos-plugin-agents-guide.md`
  - `docs/metidos-plugin-decisions.md`
- `docs/plugin-system.md` is present as the Plugin System v1 overview and links to the tutorial, authoring guide, AGENTS.md guide, decisions, manifest schema, and copyable examples.
- `docs/plugin-tutorial.md` is present and walks through building, installing, approving, and enabling a minimal local tool plugin.
- `docs/examples/plugins/` contains copyable plugin examples.

## Validation

Ran a local link-existence check for `README.md`, `docs/README.md`, and `docs/plugin-system.md` with Node. All relative Markdown links in those files resolved to tracked workspace paths; no missing plugin documentation links were found.

Command:

```bash
node - <<'NODE'
const fs = require('fs');
for (const file of ['README.md','docs/README.md','docs/plugin-system.md']) {
 const text=fs.readFileSync(file,'utf8');
 const links=[...text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map(m=>m[1]).filter(l=>!l.startsWith('http')&&!l.startsWith('#'));
 for (const link of links) {
   const target=link.split('#')[0]; if (!target) continue;
   const path=require('path').normalize(require('path').join(require('path').dirname(file),target));
   if (!fs.existsSync(path)) console.log(`MISSING ${file} -> ${link} (${path})`);
 }
}
NODE
```

Output: no missing links were printed.

## Decision

The plugin documentation is present and linked from the public README path. The final pre-public checklist item "Plugin docs are present and linked from README" can be marked complete.
