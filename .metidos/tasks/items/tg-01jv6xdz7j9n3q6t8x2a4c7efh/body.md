Document how the repo task graph admin tools are expected to behave for maintainers and agents.

## Scope

- explain when to use admin tools versus ordinary file edits
- document expected outputs for initialization, validation, and normalization
- describe policy gating and the intentionally small task-specific tool surface

## Acceptance

- maintainers can initialize and verify task graphs without reading implementation code
- agents have a concise contract for what the admin tools do and do not do
- docs stay consistent with the filesystem spec and host behavior
