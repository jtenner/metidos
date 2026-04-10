Wire the admin procedures into the Metidos host so agents can invoke them when policy allows.

## Scope

- add request and response shapes to the relevant RPC schema
- expose the three admin tools from the Bun host
- enforce runtime capability checks such as `taskGraphAdmin`
- constrain ordinary task editing to normal file tooling rather than new custom mutation calls

## Acceptance

- the host exposes `init_task_graph`, `validate_task_graph`, and `normalize_task_graph`
- denied policies fail cleanly and predictably
- successful calls return structured results suitable for the UI and agent runtime
