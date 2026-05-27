# Metidos Installation

Metidos installation is intentionally handled as an interactive wizard.

The installer should not blindly mutate the host. It must ask questions, build a plan, export that plan to `metidos-config.md`, and only then apply changes after explicit approval.

## High-level wizard flow

1. Confirm whether this is a fresh install, update, or plan-only export.
2. Check for Docker or Podman.
   - If neither is installed, stop and instruct the user to install Docker or Podman.
   - If both are installed, ask which runtime to use.
3. Choose container name, image tag, and production/development mode.
4. Choose durable app data, plugin, cache, env, log, and backup paths.
5. Choose which project directories Metidos may access.
6. Choose port and bind address.
7. Plan a base container image containing Bun and Zig.
8. Ask whether the user has an active Codex subscription.
   - If yes, check whether Codex is installed.
   - If installed, ask whether to import it.
   - If not installed, ask whether to install it via npm.
   - After login, copy only the Codex plugin into the container/plugin directory.
9. Discover core plugins and ask which ones to install.
10. Ask which model providers to add.
    - Configure supported providers directly.
    - For unsupported providers, create a Plugin System v1 provider plugin.
11. Ask which API keys should be exposed through environment variables.
12. Ask whether to integrate Telegram.
13. Ask whether to integrate Gmail.
14. Configure safety, permissions, cron/background agents, updates, backups, and diagnostics.
15. Choose access mode:
    - localhost only,
    - reverse proxy with HTTPS/domain,
    - Tailscale private network,
    - or both reverse proxy and Tailscale.
16. Review the final plan.
17. Export `metidos-config.md`.
18. Apply the installation only after approval.
19. Start the container and run health checks.
20. Show final URLs, paths, and next steps.

## Required config export

The wizard must write the approved plan to:

```text
metidos-config.md
```

The file should include runtime, paths, networking, access mode, selected plugins, Codex status, model providers, generated provider plugins, env var names, Telegram/Gmail settings, safety profile, cron settings, update/backup settings, validation checklist, and next steps.

Do not write raw secret values to `metidos-config.md`.

## Operator skill

The full agent/operator workflow lives in:

```text
.pi/skills/metidos-installation/SKILL.md
```

Use that skill as the source of truth for the detailed question order, reverse proxy instructions, Tailscale instructions, Codex branch, plugin selection, provider-plugin generation, and validation process.
