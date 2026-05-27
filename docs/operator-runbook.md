# Metidos Operator Runbook

This is a compact command reference for running an installed Metidos instance. Use the canonical installation workflow in `.pi/skills/metidos-installation/SKILL.md` for first-time setup decisions.

## Local host startup

```bash
bun install
bun run start
```

Reverse-proxy/Tailscale TLS mode:

```bash
bun run start:tls
```

Telemetry sidecar mode:

```bash
bun run start:telemetry
# or
bun run start:tls:telemetry
```

## Validation and formatting

Docs-only changes may skip full validation. Code changes should follow `.pi/skills/commit/SKILL.md`:

```bash
bun run format
bun run validate
```

Useful narrower checks:

```bash
bun run typecheck
bun run test
bun run style:check
bun run toml:check
```

## Auth operations

Regenerate recovery codes when the user can still prove the current primary factor plus TOTP:

```bash
bun run auth:reset regenerate-recovery-codes --username USERNAME
```

Reset the primary factor after proving the current factor plus TOTP:

```bash
bun run auth:reset reset-primary-factor --username USERNAME --new-type pin
# or
bun run auth:reset reset-primary-factor --username USERNAME --new-type password
```

Inspect recent security audit events:

```bash
bun run audit:log
bun run audit:log -- --json
```

## Runtime diagnostics

Run the starvation harness:

```bash
bun run harness:starvation
```

Run the Metidos tool benchmark:

```bash
bun run benchmark:metidos-tools
```

If runtime telemetry is enabled, inspect the sidecar DB out of band; do not commit runtime DB files.

## Podman operations

Start or recreate from the checked-in rootless Podman compose file:

```bash
podman compose --env-file deploy/podman/.env.podman -f deploy/podman/compose.yml up -d
```

Follow logs:

```bash
podman compose --env-file deploy/podman/.env.podman -f deploy/podman/compose.yml logs -f metidos
```

Restart after source changes without rebuilding:

```bash
scripts/restart-podman-metidos.sh
```

Rebuild only when `deploy/podman/Containerfile`, `deploy/podman/entrypoint.sh`, or image package/tooling inputs changed:

```bash
scripts/restart-podman-metidos.sh --build
```

From inside the container, terminate PID 1 and let the restart policy bring Metidos back:

```bash
scripts/restart-metidos-in-container.sh
```

Verify provider env visibility without printing secrets:

```bash
podman compose --env-file deploy/podman/.env.podman -f deploy/podman/compose.yml exec -T metidos bash -lc '
for key in OPENROUTER_API_KEY INCEPTION_API_KEY OPENAI_API_KEY ANTHROPIC_API_KEY XAI_API_KEY ZAI_API_KEY NVIDIA_API_KEY BRAVE_SEARCH_API_KEY SERPAPI_API_KEY NOTION_API_KEY GMAIL_CLIENT_ID GMAIL_CLIENT_SECRET TELEGRAM_BOT_TOKEN; do
  if [ -n "${!key:-}" ]; then
    printf "%s=set\n" "$key"
  else
    printf "%s=missing\n" "$key"
  fi
done
'
```

## Tailscale checks

```bash
tailscale serve status
curl -fsS https://YOUR_DEVICE.tailnet.ts.net/ >/tmp/metidos-tailscale-check.html
```

Use the DNS name that matches `METIDOS_PUBLIC_ORIGIN`, not the `100.x.x.x` Tailscale IP.

## Plugin operations

- Approve or re-approve plugins in Settings -> Plugins after reviewing permissions, network/file allowlists, settings/env, and review hash. These actions require recent step-up authentication.
- Retry Plugin also requires recent step-up authentication because it can restart previously approved plugin code. Disable does not require step-up because it reduces runtime exposure, though a Metidos restart is still required to fully remove already-registered v1 capabilities.
- Use Reset Plugin Data for corrupted derived `.data` caches unless the plugin `AGENTS.md` documents a safer manual repair. Reset Plugin Data requires typing the plugin folder name but does not require step-up authentication.
- Do not commit plugin `.data/**`, `.logs/**`, or `.data-bak-*` output.

## Data ownership reminders

Commit:

- `.wiki/**`
- source-controlled docs and examples

Do not commit:

- `.metidos/cache/**`
- `.metidos-build/**`
- app databases, telemetry sidecar DBs, plugin `.data/**`, plugin `.logs/**`, or secret auth files
