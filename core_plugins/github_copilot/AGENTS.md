# AGENTS for GitHub Copilot

## Purpose

First-party credential plugin for Pi's built-in `github-copilot` provider. Pi owns the provider id, endpoint, model catalog, transport, OAuth refresh, and Copilot-specific request behavior.

## Files

- `metidos-plugin.json`: manifest, `.data` quota for `auth.json`, auth path setting/env declarations, and `piAuth` binding to `github-copilot`.
- `index.ts`: no-op sidecar entry point.
- `AGENTS.md`: maintenance guide.
- `.data/auth.json`: optional runtime credential file; do not commit.

## Behavior

Do not register a model provider here. Run Pi login for GitHub Copilot, then put the Pi auth file at `.data/auth.json` or point `auth_json_path` / `GITHUB_COPILOT_AUTH_JSON_PATH` at a Pi `auth.json` containing the `github-copilot` OAuth entry.

The expected auth file shape is Pi's normal auth file shape:

```json
{
  "github-copilot": {
    "type": "oauth",
    "access": "...",
    "refresh": "...",
    "expires": 1760000000000
  }
}
```

Metidos imports that entry into Pi auth storage before runtime startup. Pi refreshes the OAuth token when needed.

## Container workflow

For container installs, mount only the auth file, read-only, into this plugin data path, similar to Codex:

```text
/path/to/pi/auth.json:/data/plugins/github_copilot/.data/auth.json:ro
```

If the source auth file must live elsewhere inside the container, set `GITHUB_COPILOT_AUTH_JSON_PATH` to that absolute container path.

## Safety

Do not store, log, or copy GitHub Copilot access or refresh tokens in plugin source. `.data/auth.json` is runtime data and must not be committed. Prefer a read-only bind mount over copying credentials when containerized.

## Embeddings and vector search

This plugin does not currently provide embedding models, call `metidos.embeddings.embed(...)`, or store LanceDB vectors. If future changes add semantic search or memory, update the manifest and this file together: embedding providers use `metidos:provides_embeddings`; embedding consumers use `metidos:can_embed`; vector storage uses `metidos:lancedb` plus `storage:write` and must stay scoped to plugin-owned `~/` data.
