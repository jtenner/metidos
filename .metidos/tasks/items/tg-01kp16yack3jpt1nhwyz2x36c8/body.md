The audit surfaced two linked execution-boundary concerns:

- unsafe mode is used for nearly every thread, effectively bypassing safer defaults
- `vm2` remains a historically risky isolation layer with a large custom fs mock and a Bun-specific global patch

## Signals

- security audit logs show near-universal `unsafe_mode_enabled` events
- `run_untrusted_js` depends on a wide and complex sandbox surface
- worker timeout and fs guard paths are tested but still deserve a stronger design story

## Desired Outcome

Narrow the default execution surface, make unsafe escalation exceptional, and either harden or replace the riskiest sandbox pieces.