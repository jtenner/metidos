# AGENTS for Weather

## Purpose

First-party plugin for the National Weather Service forecast agent tool.

## Files

- `metidos-plugin.json`: manifest, `coordinates` Plugin Setting, network allowlist, and weather access group.
- `index.ts`: registers the `weather_forecast` agent tool.

## Safety

Keep network access limited to `https://api.weather.gov/**`. The coordinates setting must remain a latitude, longitude string.

## Embeddings and vector search

This plugin does not currently provide embedding models, call `metidos.embeddings.embed(...)`, or store LanceDB vectors. If future changes add semantic search or memory, update the manifest and this file together: embedding providers use `metidos:provides_embeddings`; embedding consumers use `metidos:can_embed`; vector storage uses `metidos:lancedb` plus `storage:write` and must stay scoped to plugin-owned `~/` data.
