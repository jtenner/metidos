---
name: metidos-installation
description: Guided wizard workflow for installing Metidos in Docker or Podman, configuring runtime access through a reverse proxy or Tailscale, importing Codex, selecting core plugins, creating model-provider plugins, wiring env secrets, and enabling Telegram/Gmail integrations.
compatibility: Project skill for this repository. Use from the repository root when a user wants to install, reinstall, document, or troubleshoot a containerized Metidos deployment.
---

# Metidos Installation Wizard

Use this skill when the user wants to install Metidos, rebuild an installation guide, generate an installer plan, or configure Docker/Podman deployment.

The installer is a **wizard**, not a one-shot script. Ask the questions in order, branch based on answers, summarize before applying changes, and export the final plan to `metidos-config.md`.

## Prime directive

- Do not install, copy, generate, or mutate anything until the wizard has gathered the required answers and the user has approved the final plan.
- Ask only the next relevant question. Do not dump every advanced option unless the user asks for advanced mode.
- Never ask the user to paste secrets into chat. Prefer local terminal prompts, existing host environment variables, or placeholder env names in `metidos-config.md`.
- If a tool or runtime is missing, stop that branch and give installation instructions.
- Containerized Metidos must be built from a base image that includes **Bun** and **Zig**.
- If Codex is configured, copy **only** the Codex plugin into the container/plugin directory. Do not copy arbitrary Codex cache, unrelated host config, or broad home-directory state.
- For any custom model provider that is not already a core/supported provider, use the `metidos-plugin-authoring` skill and follow Plugin System v1 rules.

## Read first when implementing, not just planning

Before editing installer code, docs, Docker assets, or plugin manifests, read the smallest relevant set:

1. `../../../AGENTS.md` for repository-wide rules.
2. `../../../UBIQUITOUS_LANGUAGE.md` for canonical domain terms when naming user-facing concepts.
3. `../../../docs/metidos-plugin-authoring-guide.md` and `../metidos-plugin-authoring/SKILL.md` before generating or modifying provider/integration plugins.
4. Existing Docker/Podman assets in this skill folder, especially `assets/docker/`, before changing container instructions.
5. `../../../INSTALLATION.md` before updating user-facing install docs.

If the docs, implementation, and this skill disagree, treat implementation tests and public docs as source of truth, then update this skill in the same change.

## Web-researched installer references

Last reviewed: 2026-05-22. When implementing the installer, re-check these official docs because install commands and Tailscale Serve/Funnel CLI flags can change:

- Docker install docs: <https://docs.docker.com/en/latest/installation/>
- Podman install docs: <https://podman.io/docs/installation>
- Bun install docs: <https://bun.sh/docs/installation>
- Zig getting started/download docs: <https://ziglang.org/learn/getting-started/> and <https://ziglang.org/download/>
- Tailscale install docs: <https://tailscale.com/docs/install>
- Tailscale Linux install docs: <https://tailscale.com/docs/install/linux>
- Tailscale MagicDNS docs: <https://tailscale.com/docs/features/magicdns>
- Tailscale Serve docs: <https://tailscale.com/docs/features/tailscale-serve>
- `tailscale serve` CLI docs: <https://tailscale.com/kb/1242/tailscale-serve>
- Tailscale Funnel docs: <https://tailscale.com/docs/features/tailscale-funnel>
- `tailscale funnel` CLI docs: <https://tailscale.com/docs/reference/tailscale-cli/funnel>
- Tailscale tailnet policy syntax: <https://tailscale.com/kb/1337/policy-syntax>
- Tailscale policy editing docs: <https://tailscale.com/docs/features/tailnet-policy-file/manage-tailnet-policies>
- Tailscale Docker container docs: <https://tailscale.com/docs/features/containers/docker>
- Tailscale Docker configuration parameters: <https://tailscale.com/docs/features/containers/docker/docker-params>
- Tailscale Docker Compose example: <https://tailscale.com/docs/features/containers/docker/how-to/connect-docker-container>
- OpenAI Codex CLI getting started: <https://help.openai.com/en/articles/11096431-openai-codex-cli-getting-started>
- OpenAI Codex CLI sign-in with ChatGPT: <https://help.openai.com/en/articles/11381614-codex-cli-and-sign-in-with-chatgpt>

## Required output artifact

At the end of the wizard, export the approved configuration to:

```text
metidos-config.md
```

The file should be human-readable Markdown and include:

- install date/time,
- container runtime and version,
- selected install mode,
- image/container names,
- host paths and mounts,
- ports and access method,
- reverse proxy or Tailscale configuration,
- selected core plugins,
- Codex import/install decision,
- custom model providers and generated plugin ids,
- env var names, with secret values masked or omitted,
- Telegram/Gmail decisions,
- permission/safety profile,
- cron/background-agent settings,
- update/backup settings,
- validation checklist,
- next steps.

Do **not** write raw secrets into `metidos-config.md`.

## Wizard modes

At the start, ask:

```text
How detailed should the installer be?
1. Recommended install: ask only required and common questions.
2. Advanced install: ask all networking, safety, build, backup, and observability questions.
3. Export plan only: ask questions and write metidos-config.md, but do not install.
```

Default to **Recommended install** when the user is unsure.

## Wizard flow overview

Use this order unless the user explicitly asks to focus elsewhere:

1. Confirm install intent and wizard mode.
2. Detect Docker/Podman.
3. Choose runtime, install mode, and container names.
4. Choose host paths and persistence.
5. Choose project/workspace access.
6. Choose port and basic networking.
7. Prepare base container image with Bun/Zig.
8. Ask about active Codex subscription.
9. Import or install Codex, if requested.
10. Discover and select core plugins.
11. Add model providers.
12. Generate custom provider plugins when needed.
13. Add env variables and secret sources.
14. Configure Telegram integration, if requested.
15. Configure Gmail integration, if requested.
16. Configure safety, permissions, cron, updates, backups, and diagnostics.
17. Choose remote/private access: **reverse proxy** or **Tailscale**.
18. Review final plan.
19. Export `metidos-config.md`.
20. Apply installation only after explicit approval.
21. Start container and run health checks.
22. Show next steps.

## Step 1 — Confirm install intent and wizard mode

Ask:

```text
Are we installing Metidos now, generating an installation plan, or updating an existing installation?
```

Then ask the wizard mode question from above.

Record:

- fresh install vs update/reinstall,
- plan-only vs apply changes,
- recommended vs advanced mode,
- whether the user wants Docker or Podman if already known.

## Step 2 — Detect Docker/Podman

Check whether Docker or Podman is installed on the host.

If neither exists, stop and instruct the user to install one:

```text
I could not find Docker or Podman.
Install one of these, then rerun the wizard:

Docker:
- Official docs: https://docs.docker.com/en/latest/installation/
- macOS/Windows: install Docker Desktop, start it, and wait until the engine is running.
- Linux: install Docker Engine for your distribution from Docker's official repository or distro packages.
- Verify with: `docker version` and `docker compose version`.
- If Linux permission errors occur, follow Docker's post-install guidance for non-root use or run commands with appropriate privileges.

Podman:
- Official docs: https://podman.io/docs/installation
- macOS/Windows: install Podman Desktop or Podman CLI, then create/start a Podman machine if required.
- macOS common verification flow: `podman machine init`, `podman machine start`, then `podman info`.
- Linux: install `podman` from your distro packages or Podman's official instructions.
- Verify with: `podman version` and `podman info`.

After installing, make sure your user can run containers and build images without unexpected permission errors.
```

If exactly one exists, ask:

```text
I found {Docker|Podman}. Use it for this install? [Y/n]
```

If both exist, ask:

```text
I found Docker and Podman. Which should Metidos use?
1. Docker
2. Podman
```

Record:

- runtime: `docker` or `podman`,
- runtime version,
- whether rootless mode is available,
- whether the daemon/machine is running.

## Step 3 — Runtime, install mode, and container names

Ask:

```text
What should the Metidos container be named? [metidos]
```

Ask:

```text
What image tag should be built? [metidos:local]
```

In advanced mode, also ask:

```text
Should this be a development or production-style container?
1. Production-style: build image, mount only data/projects/plugins.
2. Development: mount local source for rapid iteration.
```

Defaults:

- container name: `metidos`,
- image tag: `metidos:local`,
- install mode: production-style,
- restart policy: unless stopped,
- architecture: auto-detect.

## Step 4 — Host paths and persistence

Ask:

```text
Where should Metidos store durable app data? [~/.metidos]
```

Ask:

```text
Where should Metidos keep plugins? [~/.metidos/plugins]
```

Ask:

```text
Where should Metidos keep disposable cache files? [~/.metidos/cache]
```

Ask:

```text
Where should environment configuration live? [~/.metidos/.env]
```

In advanced mode, also ask:

```text
Where should backups be written? [~/.metidos/backups]
```

```text
Where should persistent logs be written? [~/.metidos/logs]
```

Record all paths and whether each path should be created by the installer.

## Step 5 — Project/workspace access

Ask:

```text
Which project directories should Metidos be allowed to access?
Examples:
- current repository only
- ~/Projects
- a comma-separated list of specific paths
```

Ask:

```text
Should mounted projects be read/write or read-only by default?
1. Read/write for coding agents. [recommended]
2. Read-only for review/research only.
```

In advanced mode, ask:

```text
Should worktrees be created inside each project, or in a separate worktree directory?
```

Record:

- mounted project paths,
- read/write mode,
- excluded paths,
- worktree location.

Default excludes should include dependency/build/cache directories where appropriate, such as `node_modules`, `.metidos/cache`, `.next`, `dist`, and `build`.

## Step 6 — Port and basic networking

Ask:

```text
Which host port should Metidos listen on? [7331]
```

Ask:

```text
Should Metidos bind only to localhost, or be reachable on your local network?
1. localhost only: 127.0.0.1 [recommended]
2. local network: 0.0.0.0
```

Record:

- host port,
- container port,
- bind address,
- local URL.

Default to localhost-only unless the user chooses a remote/private access option in Step 17.

## Step 7 — Base container image with Bun/Zig

Before plugins and provider setup, prepare a base image plan that contains:

- Bun,
- Zig,
- Metidos runtime dependencies,
- enough build tooling to run the backend and plugin runtime,
- entrypoint/startup scripts,
- mounted app data and plugins directories.

Ask in advanced mode:

```text
Do you want to pin Bun and Zig versions, or use the installer's known-good defaults?
```

Record:

- Bun version,
- Zig version,
- base OS image,
- whether build cache is enabled,
- any extra packages.

Do not build yet. Include the planned image details in the final review.

Installation reference notes:

- Bun can be installed from the official script/package manager or by using Bun's official Docker image. Verify inside the image with `bun --version`.
- Zig's official guidance recommends downloading a self-contained archive or using a package manager. Multiple Zig versions can coexist; pin one version for reproducible image builds. Verify with `zig version`.
- Record the selected Bun and Zig versions in `metidos-config.md`.

## Step 8 — Codex subscription

Ask exactly:

```text
Do you have an active Codex subscription? [y/N]
```

If no, record `codex: skipped` and continue to core plugins.

If yes, continue to Step 9.

## Step 9 — Codex import/install branch

Check whether Codex is installed on the host.

If Codex is installed, ask:

```text
Codex appears to be installed. Would you like to import the Codex plugin into Metidos? [Y/n]
```

If the user says no, exit the Codex branch and continue.

If the user says yes:

1. Instruct the user to log in to Codex locally if not already logged in.
2. Validate that Codex login works without exposing credentials.
3. Locate the Codex plugin source needed by Metidos.
4. Copy **only** the Codex plugin into the configured Metidos plugin directory/container image staging area.
5. Do not copy unrelated host Codex state.

If Codex is not installed, ask:

```text
Codex is not installed. Would you like to install it with npm? [y/N]
```

If yes:

1. Explain that npm will install the Codex CLI/tooling on the host.
2. Ask for confirmation before running package installation.
3. Install Codex via npm using OpenAI's current official CLI package. As of the last review, OpenAI documents:

   ```bash
   npm install -g @openai/codex
   ```

4. Instruct the user to log in. For ChatGPT subscription sign-in, OpenAI documents:

   ```bash
   codex --login
   ```

5. Validate login without printing credentials or tokens.
6. Copy **only** the Codex plugin into Metidos.

If no, record `codex: subscription yes, install/import skipped` and continue.

Ask after successful import:

```text
Should the Codex plugin be enabled by default for new threads? [Y/n]
```

Record:

- host Codex installed/not installed,
- imported/installed/skipped,
- plugin path copied,
- enabled by default yes/no,
- requested permissions.

## Step 10 — Core plugin selection

Discover bundled/core plugins from the repository or release bundle. Then present a checklist.

Ask:

```text
Which core plugins would you like installed?
1. Recommended set
2. Minimal required set
3. Manual selection
```

For manual selection, show each core plugin with:

- id,
- display name,
- short purpose,
- required env vars,
- notable permissions,
- whether it is recommended or optional.

Ask:

```text
Select plugin ids to install, separated by commas.
```

For each selected plugin, record:

- install yes/no,
- enabled by default yes/no,
- required env vars,
- permissions/access groups,
- network requirements,
- mounted path requirements.

Make sure all requested core plugins are copied into the container/plugin directory or included in the image according to the selected install mode.

## Step 11 — Model providers

Ask:

```text
Do you have any model providers you would like to add? [y/N]
```

If yes, repeat this provider questionnaire for each provider:

```text
Provider display name:
Provider type:
1. Built-in/supported hosted provider
2. OpenAI-compatible endpoint
3. Local server such as Ollama or LM Studio
4. Custom provider requiring a generated plugin
```

Ask:

```text
What env var should hold the API key, if any? Example: OPENAI_API_KEY
```

Ask:

```text
What base URL should the provider use, if any?
```

Ask:

```text
Which models should be available? Include default chat/coding/fast/embedding models if known.
```

Ask:

```text
Should the installer test this provider after setup? [Y/n]
```

Record:

- provider id/name,
- type,
- base URL,
- env var names,
- model list,
- default model roles,
- capabilities: streaming, tools, JSON, vision, embeddings, long context,
- whether validation should be run.

## Step 12 — Custom provider plugin generation

When a requested provider does not already exist as a core/supported provider, create a plugin plan and then invoke/follow the `metidos-plugin-authoring` skill.

Ask:

```text
This provider needs a plugin. Should I generate a Metidos Plugin System v1 provider plugin for it? [Y/n]
```

If yes, collect:

- plugin id,
- plugin display name,
- protocol: OpenAI-compatible, Anthropic-compatible, custom REST, local command, or other,
- base URL,
- auth style: bearer token, custom header, query param, no auth,
- env vars,
- model ids,
- tool-calling support,
- streaming support,
- embeddings support,
- network allowlist,
- test prompt.

Then follow Plugin System v1 authoring rules:

- read plugin authoring docs/skill,
- choose closest example,
- generate manifest and entrypoint,
- request only required permissions,
- document secrets and logs,
- validate manifest,
- install generated plugin into the configured plugin directory only after approval.

## Step 13 — API keys and environment variables

Ask exactly:

```text
Do you have any API keys you want to use via ENV variables? List the variable names, not the secret values.
```

For each variable, ask:

```text
How should {ENV_VAR} be supplied?
1. Pass through from the host environment at container start.
2. Store in the Metidos env file as a local secret.
3. Write a placeholder only and fill it in later.
```

Ask:

```text
Which plugins or services should receive {ENV_VAR}?
1. Metidos backend only
2. All plugins
3. Selected plugins only
```

Rules:

- Do not echo or log raw secret values.
- `metidos-config.md` may list env var names and masked status only.
- Prefer least exposure: selected plugins only when practical.
- If a selected plugin declares required env vars, make sure each one has a source.

## Step 14 — Telegram integration

Ask:

```text
Would you like to integrate Telegram? [y/N]
```

If yes, walk the user through:

1. Open Telegram and message `@BotFather`.
2. Use `/newbot` to create a bot.
3. Copy the bot token into a local secret prompt or env file entry; do not paste it into chat.
4. Decide allowed chat ids/users.
5. Decide polling vs webhook:
   - polling is recommended for localhost/Tailscale/private installs,
   - webhook requires a stable HTTPS public URL.
6. Decide capabilities:
   - send notifications only,
   - start threads,
   - approve actions,
   - trigger cron jobs,
   - receive summaries.
7. Install/copy the Telegram plugin.
8. Configure env vars such as `TELEGRAM_BOT_TOKEN` and allowed chat ids.
9. Send a test message after container startup.

Ask:

```text
Should Telegram be notification-only, or should it be allowed to trigger actions?
1. Notification-only [recommended]
2. Trigger approved actions
3. Advanced custom permissions
```

Record token env var name, allowed chat ids source, polling/webhook mode, plugin id, and permissions.

## Step 15 — Gmail integration

Ask:

```text
Would you like to integrate Gmail? [y/N]
```

If yes, walk the user through:

1. Choose mode:
   - send-only,
   - read-only,
   - read/write,
   - inbox summarization,
   - approval-gated draft/send.
2. Create or select a Google Cloud project.
3. Enable the Gmail API.
4. Configure OAuth consent screen.
5. Create OAuth client credentials.
6. Configure redirect URI using the final access URL from Step 17.
7. Download/copy client credentials through a local secret path or env file; do not paste secrets into chat.
8. Choose minimal OAuth scopes.
9. Install/copy the Gmail plugin.
10. Run the OAuth flow after the container starts.
11. Store refresh tokens in the configured durable app/plugin data directory.

Ask:

```text
What Gmail permissions should Metidos request?
1. Send email only [least privilege]
2. Read message metadata
3. Read email content
4. Modify labels/archive/read state
5. Advanced custom scopes
```

Record OAuth client env vars/paths, scopes, allowed accounts, plugin id, and whether sends require approval.

## Step 16 — Safety, permissions, cron, updates, backups, diagnostics

Ask:

```text
What default agent permission profile should Metidos use?
1. Safe/read-only
2. Normal coding: read/write project files with approvals for risky actions [recommended]
3. Full local development
4. Custom
```

Ask:

```text
Should background/cron agents be enabled? [y/N]
```

If yes, ask:

- timezone,
- default model for cron jobs,
- notification channel,
- approval requirements,
- allowed schedules.

Ask in advanced mode:

```text
How should updates work?
1. Manual only [recommended]
2. Check and notify
3. Auto-update after backup
```

Ask in advanced mode:

```text
Should the installer configure backups before updates? [Y/n]
```

Ask in advanced mode:

```text
What log level should Metidos use? [info]
```

Ask in advanced mode:

```text
Enable telemetry or metrics? [N/y]
```

Record:

- permission profile,
- approval policy,
- cron enabled/disabled,
- timezone,
- update channel/policy,
- backup settings,
- log level,
- telemetry/metrics choice.

## Step 17 — Remote/private access: reverse proxy or Tailscale

This step replaces generic public deployment. The installer must explicitly ask whether the user wants a **reverse proxy** or **Tailscale** for access beyond localhost.

Ask:

```text
How should you access Metidos after installation?
1. Localhost only: http://127.0.0.1:{port}
2. Reverse proxy with HTTPS/domain
3. Tailscale private network
4. Both reverse proxy and Tailscale
```

Default to localhost only unless the user needs remote access.

### Option 1 — Localhost only

Use when Metidos is only accessed from the same machine.

Instructions:

1. Bind the container to `127.0.0.1:{host_port}`.
2. Do not expose the service on `0.0.0.0`.
3. Configure OAuth/integration callback URLs as localhost callbacks where supported.
4. Prefer Telegram polling instead of webhooks.
5. Gmail OAuth redirect may use localhost only if the OAuth client type and Google policy permit it; otherwise use reverse proxy or Tailscale with HTTPS-capable callback routing.
6. Record local URL in `metidos-config.md`.

Security notes:

- This is the safest default.
- Remote devices cannot access Metidos unless the user separately tunnels or proxies it.
- Browser access is limited to the install host.

### Option 2 — Reverse proxy with HTTPS/domain

Use when the user has a domain name or wants public/LAN HTTPS access through Caddy, Nginx, Traefik, Apache, Cloudflare Tunnel, or another proxy.

Ask:

```text
Which reverse proxy will front Metidos?
1. Caddy [recommended for simple HTTPS]
2. Nginx
3. Traefik
4. Existing reverse proxy
5. Cloudflare Tunnel or another managed tunnel
```

Ask:

```text
What public domain or hostname should serve Metidos? Example: metidos.example.com
```

Ask:

```text
Should the proxy run on the host, as a sidecar container, or outside this machine?
1. Host-managed proxy
2. Sidecar container in the same Docker/Podman network
3. Existing external proxy
```

Ask:

```text
Should Metidos trust forwarded headers from this proxy? [Y/n]
```

Ask if TLS certificates are needed:

```text
Should the proxy obtain HTTPS certificates automatically? [Y/n]
```

For Caddy, instruct:

1. Point DNS `A`/`AAAA` record for the chosen domain at the host or proxy endpoint.
2. Ensure ports `80` and `443` reach the proxy.
3. Keep Metidos bound to localhost or an internal container network, not public `0.0.0.0`, unless required by the proxy topology.
4. Configure a Caddy site similar to:

   ```caddyfile
   metidos.example.com {
     reverse_proxy 127.0.0.1:7331
   }
   ```

5. If the proxy is a container sidecar, use the Metidos service/container name and internal port instead of `127.0.0.1`.
6. Add any required websocket/streaming support. Caddy handles this automatically for normal reverse proxying.
7. Use the HTTPS URL as the external Metidos URL and OAuth callback base.

For Nginx, instruct:

1. Point DNS at the proxy host.
2. Obtain TLS certs with certbot, distro automation, or an existing certificate manager.
3. Proxy HTTP and websocket/streaming traffic to Metidos.
4. Include forwarding headers:

   ```nginx
   proxy_set_header Host $host;
   proxy_set_header X-Real-IP $remote_addr;
   proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
   proxy_set_header X-Forwarded-Proto $scheme;
   proxy_http_version 1.1;
   proxy_set_header Upgrade $http_upgrade;
   proxy_set_header Connection "upgrade";
   ```

5. Keep the upstream private where possible.

For Traefik, instruct:

1. Attach Metidos and Traefik to the same network or publish only the internal service.
2. Add router/service labels or file-provider config.
3. Configure TLS resolver and domain rule.
4. Confirm headers and websocket pass-through.

For Cloudflare Tunnel or managed tunnel, instruct:

1. Create the tunnel in the provider dashboard/CLI.
2. Route the desired hostname to `http://127.0.0.1:{host_port}` or the container service URL.
3. Enable access policies if available.
4. Treat the tunnel provider as part of the trust boundary.
5. Use the managed HTTPS hostname for OAuth callbacks and webhooks.

Reverse proxy validation checklist:

- DNS resolves to the proxy.
- HTTPS certificate is valid.
- `https://{domain}` loads Metidos.
- Websocket/streaming responses work.
- Upload/request size limits are sufficient.
- OAuth redirect URLs match the public URL exactly.
- Telegram webhook, if used, points to HTTPS public URL.
- Admin auth and CSRF/session cookie settings are correct for the external URL.
- The backend only trusts forwarded headers from the known proxy network/source.

Security notes:

- Public reverse proxy exposure increases risk. Require strong auth and MFA.
- Do not expose Docker/Podman sockets to the proxy.
- Prefer backend bind to localhost/internal network.
- Ensure access logs do not include secrets or authorization headers.
- If using Cloudflare/managed tunnels, document provider dependency and access controls.

Record in `metidos-config.md`:

- proxy type,
- domain,
- TLS mode,
- proxy location,
- upstream URL,
- forwarded headers trust setting,
- external URL,
- OAuth callback base,
- webhook base,
- firewall/DNS actions still required.

### Option 3 — Tailscale private network

Use when the user wants private access across their own devices without opening a public port or managing public DNS. Prefer Tailscale for private admin/operator access. Use Tailscale Funnel only when a service must be reachable from the public internet.

Official docs to show or link in the wizard:

- Install: <https://tailscale.com/docs/install>
- Linux install: <https://tailscale.com/docs/install/linux>
- MagicDNS: <https://tailscale.com/docs/features/magicdns>
- Serve: <https://tailscale.com/docs/features/tailscale-serve>
- Funnel: <https://tailscale.com/docs/features/tailscale-funnel>
- Funnel CLI: <https://tailscale.com/docs/reference/tailscale-cli/funnel>
- ACL/tailnet policy syntax: <https://tailscale.com/kb/1337/policy-syntax>
- Edit tailnet policy: <https://tailscale.com/docs/features/tailnet-policy-file/manage-tailnet-policies>
- Docker/container hosting: <https://tailscale.com/docs/features/containers/docker>
- Docker container parameters: <https://tailscale.com/docs/features/containers/docker/docker-params>

Ask:

```text
Is Tailscale already installed and logged in on the host? [y/N]
```

If no, instruct:

1. Install Tailscale from the official install page for the user's OS.
   - Linux: use Tailscale's package repository/script for the distro.
   - macOS/Windows: install the official app and sign in.
   - Server/headless Linux: install the package, start the daemon, then authenticate with `tailscale up`.
2. Start Tailscale.
3. Log in to the user's tailnet.
4. Verify with `tailscale status`.
5. Continue the wizard only after the host appears in the tailnet.

Ask:

```text
How should Metidos be hosted on Tailscale?
1. Host Tailscale node + Tailscale Serve forwarding localhost [recommended]
2. Host Tailscale IP or MagicDNS name plus Metidos port
3. Dedicated Tailscale container/sidecar for the Metidos container
4. Tailscale Funnel public HTTPS endpoint
```

Ask:

```text
Should Metidos remain bound to localhost, or be reachable directly on the Tailscale interface?
1. Bind Metidos to 127.0.0.1 and use Tailscale Serve/proxy [recommended]
2. Bind to the Tailscale IP/interface only
3. Bind to 0.0.0.0, protected by host firewall rules [advanced]
```

#### Recommended private hosting: host Tailscale + Serve

This pattern keeps the Metidos container private on the host and exposes it to trusted tailnet users through Tailscale Serve.

1. Keep Metidos listening on `127.0.0.1:{host_port}`.
2. Make sure MagicDNS and HTTPS certificates are enabled for the tailnet if the user wants HTTPS hostnames instead of raw IP access.
3. Verify the local app works on the host:

   ```bash
   curl http://127.0.0.1:{host_port}/
   ```

4. Start Tailscale Serve for the local HTTP service:

   ```bash
   tailscale serve --bg http://127.0.0.1:{host_port}
   ```

   If the installed Tailscale CLI uses a different current syntax, run `tailscale serve --help` and follow the official Serve docs.

5. Show current Serve status/configuration:

   ```bash
   tailscale serve status
   ```

6. Use the resulting HTTPS tailnet URL as the private Metidos URL, commonly similar to:

   ```text
   https://{machine-name}.{tailnet-name}.ts.net
   ```

7. Test from another device in the same tailnet.
8. Do not open public firewall ports.
9. Document the Serve URL and any tailnet policy assumptions in `metidos-config.md`.

Notes:

- Serve is for private tailnet access.
- Tailscale access control still applies; users/devices must be allowed by tailnet policy.
- Tailscale Serve is not a replacement for Metidos authentication. Keep Metidos auth and MFA enabled.

#### Direct private access: Tailscale IP or MagicDNS plus port

Use this only if the user does not want Tailscale Serve.

1. Find the host's Tailscale IP or MagicDNS name:

   ```bash
   tailscale ip -4
   tailscale status
   ```

2. Configure the Metidos port binding so tailnet clients can reach it.
   - Safer: bind only to the Tailscale interface/IP if the runtime supports it.
   - Advanced: bind `0.0.0.0:{host_port}` only with firewall rules that allow the port on the Tailscale interface and deny it on public interfaces.
3. Access URL examples:

   ```text
   http://{tailscale_ip}:{host_port}
   http://{magicdns-hostname}:{host_port}
   ```

4. Confirm every client device can resolve the MagicDNS name if MagicDNS is used.
5. Note that plain HTTP or non-public hostnames may not work for third-party OAuth callback requirements.

MagicDNS setup instructions for the end user:

1. Open the Tailscale admin console.
2. Go to DNS settings.
3. Enable MagicDNS if it is not already enabled.
4. Confirm the Metidos host has a recognizable machine name.
5. From another tailnet device, verify the name resolves by opening the URL or using DNS lookup.
6. Record the MagicDNS hostname in `metidos-config.md`.

Tailnet access-control instructions for private app hosting:

1. Open the Tailscale admin console.
2. Go to **Access controls**.
3. Review whether the tailnet uses legacy `acls` or newer `grants`; prefer `grants` for new policy edits when available.
4. Add or adjust a rule that lets intended users/groups/devices reach the Metidos host on the chosen port.
5. Keep access narrow. Prefer a group such as `group:metidos-admins` or selected users instead of every tailnet member.
6. Example grant shape to adapt, not paste blindly:

   ```json
   {
     "grants": [
       {
         "src": ["group:metidos-admins"],
         "dst": ["tag:metidos"],
         "ip": ["tcp:7331"]
       }
     ]
   }
   ```

7. If the host is tagged, ensure tag owners allow the operator or auth key to apply `tag:metidos`.
8. Save the policy and use Tailscale's policy check/test tools in the admin console before relying on it.
9. Verify access from an allowed device and, if practical, from a non-allowed device.

#### Container-native Tailscale hosting

Use this when the user cannot or does not want to install Tailscale on the host, or wants Metidos to appear as its own tailnet node.

Ask:

```text
Should Metidos appear as a separate Tailscale machine in your tailnet? [y/N]
```

If yes, explain the tradeoffs:

- The Tailscale container needs persistent state so it does not create a new device identity on every restart.
- The user should create an auth key in the Tailscale admin console. Prefer a tagged, reusable, ephemeral or non-ephemeral key based on the deployment model.
- Store the auth key outside chat as `TS_AUTHKEY` in the local env file or secret manager.
- Set a stable `TS_HOSTNAME`, for example `metidos`.
- Container networking differs between Docker and Podman; follow the official Tailscale Docker docs for capabilities, `/dev/net/tun`, userspace networking, and sidecar layouts.

Example Docker Compose shape to adapt, not blindly copy:

```yaml
services:
  tailscale:
    image: tailscale/tailscale:latest
    hostname: metidos
    environment:
      TS_AUTHKEY: ${TS_AUTHKEY}
      TS_STATE_DIR: /var/lib/tailscale
      TS_HOSTNAME: metidos
    volumes:
      - tailscale-state:/var/lib/tailscale
      - /dev/net/tun:/dev/net/tun
    cap_add:
      - NET_ADMIN
      - NET_RAW
    restart: unless-stopped

  metidos:
    image: metidos:local
    # Either share the Tailscale network namespace or expose Metidos only to
    # the Tailscale sidecar/reverse proxy, depending on the final topology.
    depends_on:
      - tailscale
    restart: unless-stopped

volumes:
  tailscale-state:
```

If using userspace networking instead of `/dev/net/tun`, configure it according to the current official Docker parameters and record that choice in `metidos-config.md`.

#### Public hosting with Tailscale Funnel

Use Funnel only when Metidos or a narrow callback endpoint must be reachable from the public internet. For most Telegram setups, prefer polling. For Gmail OAuth, verify the provider accepts the chosen callback URL before relying on Funnel.

Ask:

```text
Do you need public internet access, or only private tailnet access?
1. Private only: use Tailscale Serve [recommended]
2. Public HTTPS: use Tailscale Funnel for selected routes
```

If Funnel is selected, instruct the user to modify their tailnet so app hosting is allowed:

1. Open the Tailscale admin console.
2. Go to **Access controls** / tailnet policy.
3. Ensure the device/user/tag that will host Metidos is allowed to use Funnel. Tailscale controls Funnel with node attributes in the tailnet policy.
4. Add or adjust a `nodeAttrs` rule similar to this, scoped as narrowly as possible:

   ```json
   {
     "nodeAttrs": [
       {
         "target": ["tag:metidos-host"],
         "attr": ["funnel"]
       }
     ]
   }
   ```

   If the device is not tagged, target the specific user or device selector supported by the current policy syntax. Prefer a tag such as `tag:metidos-host` for servers.

5. If using tags, make sure the auth key or device is authorized to use the tag in the tailnet policy's tag-owner settings.
6. Run Serve first for the local Metidos port, then enable Funnel for the served endpoint. Typical flow:

   ```bash
   tailscale serve --bg {host_port}
   tailscale funnel --bg {host_port}
   tailscale funnel status
   ```

   If the CLI reports that only specific public ports are supported, follow the port guidance from the current `tailscale funnel --help` output.

7. Use the public Funnel URL only for routes/integrations that require public HTTPS, such as OAuth callbacks or public webhooks.
8. Prefer Telegram polling over public Telegram webhooks when possible.
9. Record the Funnel URL, nodeAttrs policy entry, and exact public exposure decision in `metidos-config.md`.

OAuth and webhook limitations with Tailscale:

- Private Serve/MagicDNS URLs are ideal for private UI access but may not be accepted by third-party OAuth providers.
- Telegram cannot reach private tailnet-only URLs; use polling unless using a public Funnel/reverse-proxy endpoint.
- Gmail OAuth redirect compatibility depends on the selected OAuth client type and accepted redirect URL. If Google rejects the Tailscale URL, use localhost OAuth or a public HTTPS reverse proxy/Funnel endpoint for the callback.
- Public Funnel exposure should be narrowly scoped and documented.

Tailscale validation checklist:

- Host or container node is logged in to Tailscale.
- Machine name, MagicDNS name, and tailnet IP are recorded.
- Tailscale Serve/Funnel status shows the expected route.
- Client device is in the same tailnet.
- ACL/grant policy allows intended users/devices and denies unintended access.
- Host firewall does not expose the port publicly unless explicitly intended.
- URL loads from another allowed tailnet device.
- OAuth and webhook requirements are compatible with the chosen Tailscale URL.
- Telegram uses polling unless a public webhook endpoint is explicitly configured.
- If using a container node, Tailscale state persists across restarts or ephemeral behavior is intentional.

Security notes:

- Tailscale is private access infrastructure, not a replacement for Metidos authentication.
- Keep MFA enabled for Metidos admin accounts.
- Limit tailnet ACLs/grants to trusted users/devices/groups.
- Avoid binding to `0.0.0.0` unless firewall rules are explicit and verified.
- Use tags and narrow grants for app-hosting devices.
- Treat Funnel as public internet exposure.
- Do not store Tailscale auth keys in `metidos-config.md`; record only the secret env var name.
- Document device, tag, ACL/grant, Serve, and Funnel assumptions in `metidos-config.md`.

Record in `metidos-config.md`:

- Tailscale installed/logged-in status,
- host-node vs container-node choice,
- tailnet hostname/IP,
- MagicDNS enabled/disabled,
- Serve usage and private URL,
- Funnel usage and public URL if enabled,
- bind strategy,
- access URL,
- tag and ACL/grant assumptions,
- auth key env var name if a container node is used,
- OAuth/webhook limitations,
- firewall actions.

### Option 4 — Both reverse proxy and Tailscale

Use when the user wants public HTTPS for selected integrations but private operator access through Tailscale, or wants a private admin URL plus a public webhook/OAuth callback URL.

Ask:

```text
Which URL should be the primary Metidos UI URL?
1. Public reverse-proxy URL
2. Tailscale private URL
```

Ask:

```text
Which integrations should use the public reverse-proxy URL?
Examples: Gmail OAuth callback, Telegram webhook, external webhooks.
```

Recommended split-mode pattern:

1. Use Tailscale for day-to-day admin/operator access.
2. Use reverse proxy only for integrations that require public HTTPS callbacks.
3. Keep public routes as narrow as possible.
4. Require Metidos auth for all UI/API routes.
5. Prefer Telegram polling over public Telegram webhooks when feasible.
6. Configure OAuth redirect paths explicitly and document them.
7. Consider separate hostnames, e.g.:
   - `metidos-admin.tailnet.ts.net` for private access,
   - `metidos.example.com` for public callback-compatible access.

Validation checklist:

- Both URLs work for their intended use.
- External URL settings match OAuth/webhook configuration.
- Cookies/session settings behave correctly with the chosen primary URL.
- Public URL does not unintentionally expose private-only workflows.
- Tailscale ACLs and public proxy auth are both configured.

Record both access paths and which integrations use each one.

## Step 18 — Review final plan

Before applying any changes, show a final plan with:

- runtime and version,
- image/container names,
- base image Bun/Zig versions,
- host paths,
- mounted projects,
- port/bind/access URLs,
- reverse proxy/Tailscale choice,
- selected core plugins,
- Codex status,
- custom providers/plugins,
- env var names and source type,
- Telegram/Gmail status,
- safety profile,
- cron settings,
- update/backup/diagnostics settings,
- files to be written,
- commands/actions to be run.

Then ask:

```text
Proceed with this plan?
1. Yes, export metidos-config.md and install.
2. Export metidos-config.md only.
3. Edit answers.
4. Cancel.
```

## Step 19 — Export metidos-config.md

Write `metidos-config.md` after the user approves the plan or chooses export-only.

Suggested structure:

```markdown
# Metidos Installation Configuration

Generated: YYYY-MM-DD HH:mm TZ

## Summary

## Container runtime

## Base image

## Paths and mounts

## Networking and access

## Reverse proxy / Tailscale

## Core plugins

## Codex

## Model providers

## Generated provider plugins

## Environment variables

## Telegram

## Gmail

## Permissions and safety

## Cron/background agents

## Updates, backups, diagnostics

## Installation actions

## Validation checklist

## Next steps
```

Secret handling requirements:

- Include env var names.
- Include source type: host pass-through, env file, placeholder, or external secret manager.
- Never include full secret values.
- Mask any accidental visible values before writing.

## Step 20 — Apply installation

Only after explicit approval:

1. Create host directories.
2. Write/update env file with placeholders or locally supplied secrets.
3. Build base image with Bun/Zig.
4. Copy selected core plugins.
5. Copy only the Codex plugin if imported.
6. Generate/copy custom provider plugins after plugin-authoring validation.
7. Configure Telegram/Gmail plugins.
8. Create container/network/volumes.
9. Start container.

If plan-only mode was selected, do not perform these actions.

## Step 21 — Health checks

After startup, validate:

- container is running,
- logs do not show fatal errors,
- Metidos HTTP endpoint responds,
- configured URL loads,
- selected plugins are discoverable,
- provider test requests pass if approved,
- Codex plugin appears if imported,
- env vars are visible only where intended,
- Telegram test message works if enabled,
- Gmail OAuth flow works if enabled,
- reverse proxy or Tailscale access works per Step 17,
- background/cron jobs are registered if enabled.

## Step 22 — Final handoff

Show:

- UI URL(s),
- where `metidos-config.md` was written,
- app data path,
- plugin path,
- env file path,
- backup path,
- how to start/stop/restart the container,
- how to update,
- how to add more plugins/providers later,
- known manual steps remaining.

## Condensed question checklist

Use this as the canonical installer prompt list.

1. Installing now, exporting a plan, or updating an existing install?
2. Recommended or advanced wizard mode?
3. Docker or Podman? If missing, install one first.
4. Container name?
5. Image tag?
6. Production-style or development container?
7. App data path?
8. Plugin path?
9. Cache path?
10. Env file path?
11. Backup/log paths?
12. Which project directories may Metidos access?
13. Project mount mode: read/write or read-only?
14. Host port?
15. Bind address?
16. Bun/Zig version pinning?
17. Do you have an active Codex subscription?
18. If yes, import existing Codex or install via npm?
19. Enable Codex plugin by default?
20. Which core plugins: recommended, minimal, or manual?
21. Do you have model providers to add?
22. For each provider: type, base URL, env var, models, capabilities, test?
23. Generate a custom provider plugin if unsupported?
24. Which API key/env var names should be available?
25. For each env var: pass-through, env file, or placeholder?
26. Which plugins receive each env var?
27. Integrate Telegram?
28. Telegram mode: polling/webhook, chat ids, capabilities?
29. Integrate Gmail?
30. Gmail mode, OAuth credentials, scopes, account, approval policy?
31. Default safety/permission profile?
32. Enable cron/background agents?
33. Updates, backups, logs, telemetry?
34. Access method: localhost, reverse proxy, Tailscale, or both?
35. Reverse proxy details, if selected?
36. Tailscale details, if selected?
37. Review final plan: install, export only, edit, or cancel?

## Failure and recovery guidance

- If Docker/Podman is unavailable, stop and install it first.
- If image build fails, keep `metidos-config.md`, fix base image dependencies, and rerun from Step 7.
- If plugin validation fails, do not install that plugin; return to plugin authoring workflow.
- If a secret is missing, write a placeholder and mark validation blocked.
- If reverse proxy TLS fails, fall back to localhost or Tailscale while DNS/certificates are fixed.
- If Tailscale access fails, verify login, ACLs, MagicDNS, host firewall, and bind strategy.
- If OAuth callback validation fails, revisit Step 17 and align external URL, callback path, and provider console settings.
