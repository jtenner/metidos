# .tasks

This folder defines the repository’s local contribution process instructions.
It contains short operational documents that should be consulted before making changes.

## Files

- `commit.md`
  - Repository commit policy for this codebase.
  - Defines required commit workflow (`git commit -F` with detailed message), documentation sync expectations, and validation rules.
  - Explains when `bun validate` can be skipped for docs-only updates.
- `research.md`
  - Documentation standards and expectations for adding new design/feature/architecture notes.
  - Gives content structure guidance for new docs: summary + detailed sections, and quality expectations for migration/new-feature/design/API/architecture writeups.
- `style.md`
  - Main UI style guide and styling cleanup proposal for `src/mainview/`.
  - Defines the desired visual language, semantic token direction, component rules, migration priorities, and the explicit ban on introducing new card-based UI patterns.
- `todo.md`
  - Maintainer guide for the canonical `.metidos/tasks/` task graph.
  - Describes the on-disk format, current repo conventions, and the normal file-based workflow for creating and updating tasks.
