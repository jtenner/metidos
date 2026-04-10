Implement validation for canonical task graph files.

## Scope

- detect missing required files and invalid schema values
- detect duplicate task IDs and unresolved task references
- validate status, priority, type, and tag shapes against repo config
- return structured findings that the host can display without parsing plain text

## Acceptance

- invalid repositories produce actionable diagnostics with file context
- clean repositories return a success result with no errors
- validation distinguishes between hard failures and softer warnings where appropriate
