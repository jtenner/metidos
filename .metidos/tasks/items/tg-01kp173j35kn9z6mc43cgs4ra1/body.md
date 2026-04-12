Align repo guidance with the git-native task graph spec so maintainers know which `.metidos/` files are canonical and which are generated.

## Scope

- update `AGENTS.md` and any nearby process docs that currently blur canonical versus generated files
- keep derived caches and generated artifacts explicitly outside version control
- reference the task graph spec so future edits follow one policy

## Acceptance

- repo guidance explicitly treats `.metidos/tasks/` as canonical source of truth
- generated cache/build artifacts remain clearly gitignored
- future contributors can tell the difference without reading multiple contradictory docs