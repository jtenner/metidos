Refactor the Metidos tool host so schema declarations, scope enforcement, host wiring, and result formatting are grouped by tool domain instead of living in one large file.

## Scope

- split thread, cron, context, and sandbox tool definitions into smaller modules
- keep tool names and host behavior stable
- preserve existing safe-thread restrictions and scope checks

## Acceptance

- tool definitions are easier to audit and extend without scanning a 1.4k-line file
- schema and host wiring changes have smaller diffs
- current tool tests keep passing after the split