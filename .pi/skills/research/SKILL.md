---
name: research
description: Maintain the Metidos research wiki in .wiki, including ingesting raw sources, answering durable research questions, updating index/log pages, linting wiki health, and writing research, design, migration, API, or architecture notes.
---

# Research Wiki Guide

This is the canonical schema for repository research documents. Research, design, migration, API, and architecture notes belong in `.wiki/`, not `docs/`.

This guide adopts the core pattern from Andrej Karpathy's April 2026 "LLM Wiki" gist: keep immutable raw sources, maintain an LLM-readable markdown wiki, and use a schema to tell the agent how to ingest, query, and lint the knowledge base. In this repo, this skill is that schema. The exact folder mapping below is this repository's adaptation of the pattern.

## Core model

There are three layers:

1. **Raw sources**: immutable inputs such as articles, PDFs, transcripts, copied notes, benchmark output, or issue links. These are source-of-truth materials.
2. **The wiki**: interlinked markdown pages in `.wiki/` that summarize, compare, synthesize, and cross-reference the source material.
3. **The schema**: this skill plus any narrowly relevant top-level process docs that tell the agent how to structure, update, and maintain the wiki.

Human role:

- choose sources
- ask questions
- steer emphasis
- verify conclusions

Agent role:

- summarize
- cross-reference
- update related pages
- maintain the index and log
- identify contradictions, gaps, and stale claims

## Repository mapping

Use this structure:

```text
.wiki/
  index.md
  log.md
  raw/
  <topic-page>.md
```

Rules:

- All research documents go in `.wiki/`.
- `index.md` is the content catalog for the wiki.
- `log.md` is the append-only chronological record of ingest, query, and lint activity.
- `.wiki/raw/` is for immutable source captures when local copies are needed.
- `docs/` is not the default home for research notes anymore. Prefer `.wiki/` for ongoing knowledge accumulation.

## Special files

### `.wiki/index.md`

`index.md` is content-oriented. It should list wiki pages with:

- link
- one-line summary
- optional metadata such as date, status, or source count

Use it as the first navigation surface. When adding or materially changing a wiki page, update `index.md`.

### `.wiki/log.md`

`log.md` is chronological and append-only. Record:

- ingests
- important queries
- lint passes
- major synthesis updates

Use a consistent heading prefix so the log stays machine-parseable, for example:

```md
## [2026-04-19] ingest | Karpathy LLM Wiki
## [2026-04-19] query | Compare wiki workflow to current repo docs
## [2026-04-19] lint | backlinks and stale-claim review
```

## Operations

### 1. Ingest

When new research arrives:

1. Preserve or link the raw source.
2. Read it closely enough to extract the important claims.
3. Create or update one or more `.wiki/*.md` pages.
4. Update `index.md`.
5. Append an entry to `log.md`.
6. Update adjacent pages that should now link to or mention the new material.

Prefer ingesting one source at a time when the material is important or ambiguous.

### 2. Query

When answering a substantive research question:

1. Read `index.md` first.
2. Open the most relevant wiki pages.
3. Synthesize an answer with citations or explicit references to the underlying sources/pages.
4. If the result is durable, file it back into `.wiki/` as a new or updated page.
5. Append the query outcome to `log.md` when it creates durable knowledge.

Research should compound. Valuable analysis should not disappear into chat history.

### 3. Lint

Periodically health-check the wiki for:

- contradictions between pages
- stale claims superseded by newer information
- orphan pages with weak linking
- important concepts that lack their own page
- missing cross-references
- missing source references
- obvious research gaps worth further search

Record meaningful lint passes in `log.md`.

## Writing rules for wiki pages

Every research page in `.wiki/` should:

- start with a short summary
- separate current state from proposed state when relevant
- state whether a claim is observed, inferred, or recommended
- name concrete files, modules, RPC methods, tools, workflows, or external sources when they matter
- link related wiki pages
- preserve enough context that a future agent can understand the decision without reopening the original chat

Recommended sections, adapted to the page type:

- Summary
- Problem
- Current state
- Proposed change
- Design or analysis
- Risks
- Alternatives
- Validation
- Open questions

## Doc-type requirements

### Migration pages

Explain:

- current state
- desired state
- why migration is needed
- migration steps
- rollout/fallback concerns
- compatibility risks

### Feature pages

Explain:

- user or operator problem
- why current behavior is insufficient
- proposed behavior
- end-to-end flow
- constraints and validation plan

### Design pages

Explain:

- the design problem
- intended interaction or system behavior
- why this approach beats likely alternatives
- invariants that implementation must preserve

### API pages

Explain:

- caller problem
- contract shape
- important inputs and outputs
- error behavior
- compatibility/versioning concerns
- examples when useful

### Architecture pages

Explain:

- system problem
- current boundaries and pain points
- proposed boundaries and responsibilities
- data/control flow
- operational consequences
- adoption strategy if relevant

## Source-of-truth rules

- Raw sources remain authoritative for factual claims.
- Wiki pages are maintained syntheses, not replacements for the source material.
- Do not silently turn speculation into fact.
- When a page contains synthesis or inference, label it clearly.
- If a claim is likely to change, store when it was observed.

## Naming and organization

- Prefer stable descriptive filenames for topic pages, e.g. `.wiki/provider-auth-flow.md`.
- Use date-prefixed names only when the page is inherently time-bound, e.g. audits, incident reviews, or one-off research snapshots.
- Split pages when they become too broad to maintain clean summaries and links.
- Prefer cross-linking over duplicating the same explanation in many pages.

## Quality bar

A strong wiki page should let a future agent answer:

- what problem was being studied
- what was learned or decided
- why that conclusion was reached
- what code or workflow areas are affected
- what follow-up questions remain

## Repo policy

- New research/design/migration/architecture notes should be created in `.wiki/`.
- Existing legacy material under `docs/` may remain until touched, but new research-shaped docs should not start there.
- Keep process docs such as `AGENTS.md` and `STYLE.md` at the repo root when they are not skills.
- Keep commit and research workflow policy in `.pi/skills/commit/SKILL.md` and `.pi/skills/research/SKILL.md`.
