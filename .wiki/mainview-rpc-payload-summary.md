# Mainview RPC payload summary

Date: 2026-05-02

## Current split

`getAppBootstrap` intentionally returns summary/list surfaces only. Thread transcript detail remains split behind `getThread`, and the bootstrap result keeps `threadDetail: null` so startup can paint without inactive transcript bodies, tool outputs, image payloads, or screenshots.

## Runtime measurement

The backend now emits a trace-level `App bootstrap RPC payload byte summary` record with total serialized JSON bytes and component byte counts for:

- `modelCatalog`
- `threadPermissionDescriptors`
- `threads`
- `projects`
- `pluginAccessGroups`
- `pinnedWorktrees`
- `homeDirectory`

Enable `METIDOS_TRACE_LOGS=1` to capture the measurement during startup and compare top transfer offenders before deeper DTO splits.

## Remaining likely offenders

Expected next candidates for summary/detail RPCs are model catalog capability metadata, thread permission descriptors, and settings-only plugin access metadata if trace measurements show they dominate startup transfer size.
