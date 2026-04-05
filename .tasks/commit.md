# Commit Requirements

- Use a detailed commit message and commit with `git commit -F`.
- Ensure all relevant documents in the repo are checked so changes are reflected consistently across docs.
- Update the file tree in `AGENTS.md`.
- For code changes, run `bun format` before `bun validate`, then commit.
- Skip validation (`bun validate`) for docs-only changes.
- Keep each set of features and fixes in one atomic commit.
