The audit found that the agent tool surface is broad, but the observability and resource-control story is still uneven.

## Signals

- runtime stats cover important core paths but not all per-tool or unsafe-mode events
- cron already has queue caps, but the broader tool surface lacks equivalent budgeting and saturation controls
- `pi-metidos-tools.ts` is large and difficult to audit in one pass

## Desired Outcome

Expose granular tool telemetry and enforce budgets so heavy or unsafe tool usage is measurable and bounded.