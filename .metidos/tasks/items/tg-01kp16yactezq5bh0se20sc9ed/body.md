Split the large auth orchestration surface into smaller modules that isolate setup, login, recovery, session resolution, websocket tickets, and step-up enforcement.

## Scope

- move low-level timing and state-transition helpers out of the top-level auth service file
- keep public behavior and error codes stable while improving readability
- make later hardening work less risky by reducing incidental churn

## Acceptance

- the auth service entrypoints remain easy to discover, but the file no longer owns every detail
- extracted modules are small enough to review in isolation
- auth tests continue to pass without semantic drift