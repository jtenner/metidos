---
name: commit
description: Follow the canonical Metidos repository commit workflow, including atomic commits, validation policy, documentation sync, and detailed commit messages. Use when committing changes, preparing a commit, validating a change before commit, or updating repository workflow guidance.
---

# Commit Strategy

This is the canonical commit workflow for this repository.

## Core rules

- Keep each feature, fix, or docs update in one atomic commit.
- Use a detailed commit message and commit with `git commit -F`.
- Check related docs when behavior, process, or repo structure changes so the written guidance stays in sync.
- Keep `AGENTS.md` succinct. Put durable process detail in focused docs and skills such as this skill.

## Validation policy

- For code changes, run `bun format` before `bun validate`.
- For docs-only changes, you may skip `bun validate`.

## Documentation sync checklist

When a change affects repository workflow or structure, update the relevant guidance in the same slice. Common files to check are:

- `AGENTS.md`
- `.pi/skills/commit/SKILL.md`
- `STYLE.md` for UI work
- `.pi/skills/research/SKILL.md` for research/wiki policy
- `.wiki/` for durable research/design/migration pages
- subsystem `README.md` files under `src/` or `docs/`

## Commit message expectations

A good commit message should make the slice legible without reopening the diff. Include:

- what changed
- why it changed
- any important constraints, follow-ups, or migration notes

## Before committing

- Review the diff for unrelated edits.
- Make sure generated or derived artifacts are not being committed unless they are canonical repo data.
- Commit research wiki files under `.wiki/**` when they are part of the slice.
