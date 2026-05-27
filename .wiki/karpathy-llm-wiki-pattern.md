# Karpathy LLM Wiki Pattern

## Summary

Andrej Karpathy's LLM Wiki pattern treats a knowledge base as three layers: immutable raw sources, an LLM-maintained markdown wiki, and a schema document that tells the agent how to ingest sources, answer questions, and keep the wiki healthy. The important operational loop is ingest → query → lint, with durable answers filed back into the wiki instead of disappearing into chat history.

## Source

Primary source:

- Andrej Karpathy, "LLM Wiki" gist, April 2026.

## Core pattern

The pattern has three layers:

- raw sources that the agent reads but does not edit
- wiki pages that the agent owns and maintains
- a schema file that defines conventions and workflow

The human curates sources and steers the analysis. The agent handles summarization, cross-references, filing, and bookkeeping.

## Operations

### Ingest

When a source is added, the agent should read it, summarize it, update related pages, refresh the index, and append a log entry.

### Query

Questions are answered against the wiki first. Durable comparisons, analyses, and syntheses should be written back into the wiki as pages.

### Lint

The wiki should be checked for contradictions, stale claims, weak linking, missing concept pages, and research gaps.

## Index and log

Two special files matter:

- `index.md` as the content catalog for navigation
- `log.md` as the chronological, append-only activity trail

## Repo adaptation

Inference for this repository:

- `.wiki/` is the wiki layer
- `.wiki/raw/` is the source layer when local captures are needed
- `.pi/skills/research/SKILL.md` is the schema for research-writing behavior
- top-level process docs remain separate from the wiki because they are policy, not research pages

## Why this is useful here

This repo accumulates design notes, migration ideas, architecture investigations, audits, and implementation tradeoffs. The wiki pattern is a better fit than scattering one-off docs because it encourages:

- durable synthesis
- explicit cross-linking
- cumulative research instead of chat-only answers
- periodic maintenance rather than abandoned notes

## Open questions

- Whether legacy research docs in `docs/` should be migrated gradually into `.wiki/`.
- Whether `.wiki/raw/` should eventually store clipped external sources or only links and excerpts.
