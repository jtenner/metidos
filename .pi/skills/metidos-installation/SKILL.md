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
- selected install target (Docker/Podman/source),
- selected install mode,
- image/container names,
- unsupported-harness requests and refusal decisions,
- services/tools defaults and calendar bootstrap notes,
- browser preference and browser-core plugin selection (`chrome_browser`) details,
- browser/Chromium capability and runtime prerequisites,
- custom API notes for non-provider integrations,
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

## Wizard behavior contract

Ask one question at a time and require an answer before moving on.

- Ask only one question per interaction.
- Do not assume any answer for the user.
- Branch immediately on security-sensitive answers (unsupported harnesses, browser access, ICS imports, etc.).
- Pause for user confirmation before any filesystem/runtime actions.

## Wizard flow overview

Use this order unless the user explicitly asks to focus elsewhere:

1. Confirm install intent and wizard mode.
2. Choose install method: Docker, Podman, or source.
3. Detect Docker/Podman runtime version/status (container path only).
4. Choose container runtime, install mode, and container names.
5. Choose host paths and persistence.
6. Choose project/workspace access.
7. Choose port and basic networking.
8. Prepare base container image with Bun/Zig.
9. Ask about active Codex subscription.
10. Import or install Codex, if requested.
11. Discover and select core plugins.
12. Add custom APIs and model providers.
13. Generate custom provider plugins when needed.
14. Ask service/tool access and browser-internet settings.
15. Add API keys and environment variable sources.
16. Configure Telegram integration, if requested.
17. Configure Gmail integration, if requested.
18. Configure safety, permissions, cron, updates, backups, and diagnostics.
19. Choose remote/private access: **reverse proxy** or **Tailscale**.
20. Review final plan.
21. Export `metidos-config.md`.
22. Apply installation only after explicit approval.
23. Start container and run health checks (or confirm source startup).
24. Show next steps (final handoff).

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
- whether the user wants Docker, Podman, or source mode if already known.

## Step 2 — Choose install target

Ask exactly one question:

```text
How would you like to install Metidos? (Docker, Podman, or run from source) [Docker]
```

If `source`:

1. Confirm this is a clean checkout of this repo.
2. Record source mode in `metidos-config.md`.
3. Ask for confirmation of source path (default `.`), and skip all container-specific steps (runtime detection, container image, compose, volumes, mounts).
4. Continue to Step 12 (model/API/provider choices) using source-mode defaults.

If `docker` or `podman`:

Proceed to Step 3 to detect the selected runtime and then continue with container steps.

## Step 3 — Detect Docker/Podman

Check whether the requested runtime is installed on the host.

If neither exists, stop and instruct the user to install the selected runtime:

```text
I could not find the selected runtime ({Docker|Podman}).
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

If exactly one matching runtime exists, ask:

```text
I found {Docker|Podman}. Use it for this install? [Y/n]
```

If both exist and container mode is selected, ask:

```text
I found Docker and Podman. Which should Metidos use?
1. Docker
2. Podman
```

Record:

- requested/selected runtime (`docker` or `podman`),
- runtime version,
- whether rootless mode is available,
- whether the daemon/machine is running.

## Step 4 — Runtime, install mode, and container names

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

## Step 5 — Host paths and persistence

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

## Step 6 — Project/workspace access

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

## Step 7 — Port and basic networking

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

Default to localhost-only unless the user chooses a remote/private access option in Step 18.

## Step 8 — Base container image with Bun/Zig

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

## Step 9 — Codex subscription

Ask exactly:

```text
Do you have an active Codex subscription? [y/N]
```

If no, record `codex: skipped` and continue to core plugins.

If yes, continue to Step 10.

## Step 10 — Codex import/install branch

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

## Step 11 — Core plugin selection

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

## Step 12 — API discovery and model providers

Known model-provider plugins currently in-repo (plugin-backed providers):

- `ai21`
- `aleph_alpha`
- `anthropic`
- `anyscale`
- `azure_openai`
- `baseten`
- `bedrock`
- `bifrost`
- `cerebras`
- `chutes`
- `cloudflare`
- `codex` (provider ID: `openai-codex`)
- `cohere`
- `custom_openai`
- `dashscope`
- `deepinfra`
- `deepseek`
- `fal`
- `fireworks`
- `github_copilot` (provider ID: `github-copilot`)
- `github_models`
- `gemini`
- `groq`
- `huggingface`
- `inceptionlabs`
- `inflection`
- `localai`
- `lepton`
- `llamacpp`
- `lmstudio`
- `litellm`
- `mistral`
- `minimax`
- `moonshot`
- `modal`
- `nebius`
- `novita`
- `nvidia_build`
- `ollama`
- `openai`
- `openrouter`
- `perplexity`
- `qianfan`
- `replicate`
- `runpod`
- `rutaapi`
- `sagemaker`
- `sambanova`
- `sglang`
- `siliconflow`
- `stepfun`
- `therouter`
- `together`
- `tokenhub`
- `tokenmix`
- `upstage`
- `vertex`
- `vllm`
- `volcengine`
- `writer`
- `xai`
- `yi`
- `zai`

Use this list when helping users pick from built-in providers before asking for custom ones.

Ask exactly one question:

```text
Which model providers should be enabled now?
Reply with `none` or one comma-separated list of plugin IDs from the list above.
Examples:
- `openai,openrouter`
- `ollama`
- `custom_openai,localai,replicate`
```

Record provider plugin IDs as `selected_model_provider_plugins`.

If the answer contains any provider-like identifiers that are not in this list (for example, `claude`/`claude_code`/`cursor`):
- Treat those as custom APIs/harness requests.
- If they are harnesses (for example, Claude Code or Cursor), state: **not supported by this installer pass** and ask:

```text
Harness integrations (for example, Claude Code/Cursor) are not supported in this installer pass. Continue with supported model/tooling options only? [Y/n]
```

- If the user declines, set `install: blocked-by-unsupported-harness-request` and stop before applying changes.

For any non-plugin model/chat endpoints the user still wants, ask one compact question:

```text
List custom model/chat APIs (or `none`), one per item in this format: `name|type|base_url|auth_model|api_var|default_models`.
Allowed type: `openai_compatible` or `local`.
```

For non-model integrations (for example, calendar/repo/internal tools) ask:

```text
List non-model integrations you want noted in the plan (or `none`).
```

Important compatibility note: supported provider paths are only
- built-in plugin providers,
- OpenAI-compatible/local endpoints,
- custom provider plugins built through Plugin System v1.

When custom entries are present, branch into Step 13 (custom provider plugin generation) as needed.

Record:

- provider plugin IDs selected,
- custom API specs (name/type/base_url/auth/api_var/models),
- whether harness requests were rejected, and
- whether a non-model integration note was recorded.

## Step 12-b — Services, tool access, browser access, and calendar feeds

Ask:

```text
What services and tools should Metidos agents be able to use by default?
```

Collect a checklist (or single list) across these categories:

- Web search
- Browser tools / web navigation
- Git
- GitHub
- SQLite
- Calendar (calendar create/list/edit)
- Notifications
- Threads/Cron coordination
- Plugin tools (approved plugin access groups)
- Unsafe actions (high-risk)

Ask:

```text
Do you want your agents to browse the internet using Chromium? [Y/n]
```

If yes:

- Install and enable the provided browser core plugin:
  - `chrome_browser` (plugin id) must be selected for this install (or added to custom plugins if missing).
  - Require `chrome_browser:browser_tools` in thread access controls and plugin approval before running browser automation.
- Source install: confirm Chromium/CDP support is available in the host/container where the runtime executes, and capture any manual launch/setup note needed.
- Docker install: note that the provided Docker template path does not bundle Chromium by default; either switch to Podman or defer browser automation with a documented follow-up.
- Podman install: confirm the runtime can launch Chromium/CDP in-container and record the method used by the `chrome_browser` plugin to create sessions.

Ask:

```text
Do you have any calendar (ICS) URLs you want to import?
1. No
2. Yes, one or more
```

If yes:

- Ask for each ICS feed URL and optional display name.
- Ask whether each feed should be imported as read-only.
- Ask if import should happen immediately after first install login.

Record:

- default allowed service/tool groups for the first-thread profile,
- browser access preference and required runtime prerequisites,
- ICS URL list and any manual follow-up required after first login.

## Step 13 — Custom provider plugin generation

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
## Step 14 — API keys and environment variables

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

## Step 15 — Telegram integration

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

## Step 16 — Gmail integration

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
6. Configure redirect URI using the final access URL from Step 18.
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

## Step 17 — Safety, permissions, cron, updates, backups, diagnostics

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

## Step 18 — Remote/private access: reverse proxy or Tailscale

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

## Step 19 — Review final plan

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

## Step 20 — Export metidos-config.md

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

## Step 21 — Apply installation

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

## Step 22 — Health checks

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
- reverse proxy or Tailscale access works per Step 18,
- background/cron jobs are registered if enabled.

## Step 24 — Final handoff

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

## Local source install, provider, and startup reference

Use this reference when the wizard is targeting a local source checkout rather than a container image, or when migrating legacy README setup details into an installation plan.

### Local source install

```bash
bun install
cp .env.example .env
```

Bun auto-loads `.env` for `bun run ...` commands. For env-backed providers, add the provider vars you want to `.env`, then restart Metidos after each change.

### Model provider setup

Metidos shows providers that are missing setup as disabled in the model selector.

| Provider in Metidos | How to enable |
|---------------------|---------------|
| OpenAI API | Add `OPENAI_API_KEY=...` to `.env`, or approve the OpenAI core plugin and save `api_key` in Settings -> Plugins. Pi owns the built-in chat provider, model catalog, endpoint metadata, and transport; the core plugin also registers OpenAI embedding models for Metidos vector search. |
| OpenAI Codex | Install the `codex` CLI, run `codex login`, and make sure the CLI is on `PATH`. Metidos uses Pi's built-in `openai-codex` provider; the Codex core plugin imports `plugins/codex/.data/auth.json` when present and otherwise falls back to `$CODEX_HOME/auth.json` or `~/.codex/auth.json`. No plugin-defined provider is registered. |
| GitHub Copilot | Approve the GitHub Copilot core plugin and point it at a Pi auth JSON containing a `github-copilot` OAuth entry, usually produced by Pi login and mounted/copied to `plugins/github_copilot/.data/auth.json` or referenced through `GITHUB_COPILOT_AUTH_JSON_PATH`. Pi owns the built-in `github-copilot` provider, OAuth refresh, model catalog, and transport. |
| Anthropic | Add `ANTHROPIC_API_KEY=...` to `.env`, or approve the settings-only Anthropic core plugin and save `api_key` in Settings -> Plugins. `ANTHROPIC_OAUTH_TOKEN` also works through Pi's normal env fallback. |
| Google | Add `GEMINI_API_KEY=...` to `.env` and restart. |
| Google Vertex | Add either `GOOGLE_CLOUD_API_KEY=...` or both `GOOGLE_CLOUD_PROJECT=...` (or `GCLOUD_PROJECT=...`) and `GOOGLE_CLOUD_LOCATION=...`, then restart. Pi can also use ADC once those project/location settings are present. |
| Azure OpenAI | Add `AZURE_OPENAI_API_KEY=...` plus either `AZURE_OPENAI_BASE_URL=...` or `AZURE_OPENAI_RESOURCE_NAME=...`, then restart. `AZURE_OPENAI_API_VERSION` and `AZURE_OPENAI_DEPLOYMENT_NAME_MAP` are optional. |
| Amazon Bedrock | Configure one of: `AWS_PROFILE=...`, `AWS_BEARER_TOKEN_BEDROCK=...`, or both `AWS_ACCESS_KEY_ID=...` and `AWS_SECRET_ACCESS_KEY=...`. In practice you usually also want `AWS_REGION=...`. Restart Metidos after changing env. |
| Groq | Add `GROQ_API_KEY=...` to `.env` and restart. |
| Kimi Coding | Add `KIMI_API_KEY=...` to `.env` and restart. |
| MiniMax | Add `MINIMAX_API_KEY=...` to `.env` and restart. |
| Mistral | Add `MISTRAL_API_KEY=...` to `.env` and restart. |
| OpenRouter | Add `OPENROUTER_API_KEY=...` to `.env`, or approve the OpenRouter core plugin and save `api_key` in Settings -> Plugins. The plugin registers chat and embedding providers, discovers models from OpenRouter's upstream catalogs, routes embeddings through OpenRouter, and still lets Pi supply the OpenAI-compatible chat transport. |
| Inception Labs Mercury | Add `INCEPTION_API_KEY=...` to `.env`, or approve the Inception Labs Mercury core plugin and save `api_key` in Settings -> Plugins. The plugin registers Mercury 2 as an OpenAI-compatible provider. |
| xAI | Add `XAI_API_KEY=...` to `.env`, or approve the xAI core plugin and save `api_key` in Settings -> Plugins. The plugin registers the provider and discovers current chat/coding models from xAI's upstream `/v1/models` endpoint. |
| Z.AI | Add `ZAI_API_KEY=...` to `.env`, or approve the Z.AI core plugin and save `api_key` in Settings -> Plugins. The plugin registers the `zai` provider and defaults to the General API endpoint for long-lived console API keys; switch the plugin `endpoint` setting to `coding_plan` only for Coding Plan tokens. |
| Build NVIDIA | Approve the Build NVIDIA core plugin and save the `api_key` Plugin Setting in Settings -> Plugins, or add `NVIDIA_API_KEY=...` to `.env` and restart. The plugin registers a Plugin System v1 model provider and discovers chat models from NVIDIA's `/v1/models` endpoint when a key is available. If discovery fails or returns no models, Metidos shows no Build NVIDIA models instead of inventing fallback entries. |
| Ollama | Approve the Ollama core plugin and optionally save the `base_url` and `api_key` Plugin Settings in Settings -> Plugins, or set `OLLAMA_BASE_URL=...` and optional `OLLAMA_API_KEY=...` in `.env`. The plugin registers a Plugin System v1 provider, defaults to `http://localhost:11434`, discovers native `/api/tags` first, falls back to `/v1/models`, and returns no models when discovery fails rather than inventing a placeholder. Container deployments that reach host Ollama through a private/loopback address must include `ollama` in `METIDOS_PLUGIN_UNSAFE_PRIVATE_NETWORK_PLUGINS` and approve the plugin's unsafe permission. |

Notes:

- Metidos keeps its Pi auth and registry state under its own app-data directory at `<app-data>/pi-agent/`, not Pi's standalone `~/.pi/agent/`. Newly created app-data directory trees are tightened to owner-only POSIX permissions where supported. Plugin-backed providers such as Ollama and Build NVIDIA are registered by approved Plugin System v1 sidecars and then projected into the Pi registry/catalog at runtime.
- Metidos keeps **OpenAI API** and **OpenAI Codex** as separate providers even when they expose the same raw model id such as `gpt-5.4`. Choose the one that matches the auth, billing, and policy boundary you want.
- More detail on provider wiring lives in `../../../.wiki/ollama-via-pi-configuration.md`, `../../../.wiki/nvidia-build-via-pi-configuration.md`, `../../../.wiki/openrouter-via-pi-configuration.md`, and `../../../.wiki/codex-via-pi-wiring.md`. Pi-built-in providers generally use Pi's catalog; first-party core plugins that declare `provider:register` own their provider's runtime catalog.

### Thread and cron feature setup

| Feature | How to enable | Extra setup |
|---------|---------------|-------------|
| Web Search | Turn on **Web Search** in the thread or cron access controls. | For `OpenAI API` and `OpenAI Codex` GPT-5/o3/o4-class models, Metidos uses provider-native web search. For other providers, Metidos falls back to Brave-backed `web_search` plus direct `web_fetch`; set `BRAVE_SEARCH_API_KEY` for fallback search. |
| Browser plugins | Approve and select a browser-control plugin access group, such as `chrome_browser:browser_tools`. | For the Chrome browser plugin, install Chrome/Chromium or use the bundled/container Chromium setup; screenshots and browser control are plugin-provided rather than native Metidos WebView tools. |
| GitHub | Turn on **GitHub** in the access controls. | Install GitHub CLI (`gh`), ensure it is on `PATH`, and authenticate with `gh auth login`. The current worktree must resolve to a GitHub repository. |
| Git | Turn on **Git** in the access controls. | Install `git` and keep the worktree inside a Git repository. |
| SQLite | Turn on **SQLite** in the access controls. | No extra global setup. Queries are limited to database files inside the current worktree. |
| LanceDB | Turn on **LanceDB** in the access controls. | Enables project-scoped vector tools: `lancedb_upsert`, `lancedb_query`, and `lancedb_delete`. Query text is embedded through the configured Metidos embedding provider, such as the approved OpenAI or Ollama core plugin. |
| WebServer | Turn on **WebServer** in the access controls. | Hosts files from the current worktree through `web_server_host`, `web_server_stop`, and `web_server_list`; stable share routes use the share worker. |
| Calendar | Turn on **Calendar** in the access controls. | No extra global setup. |
| Notifications | Turn on **Notifications** in the access controls. | Configure a notification provider such as the ntfy core plugin if you want delivery outside the app. |
| Threads | Turn on **Threads** in the access controls. | Enables Metidos thread listing and child-thread tools. |
| Crons | Turn on **Crons** in the access controls. | Enables Metidos cron listing, creation, and update tools. |
| Agents | Turn on **Agents** in the access controls. | No extra setup. |
| Plugin tools | Select approved plugin access groups in the access controls. | Access groups expose agent-visible plugin tools; plugin host API permissions still come from the approved manifest. The Gmail core plugin provides separate read and draft-only access groups; configure Google OAuth client settings and the local Gmail refresh token before enabling those tools. Internal prompt-injection capability is not shown as a normal user-selectable tool family. |
| Terminal tools | Enable the full unsafe terminal policy intentionally. | Managed terminal tools are high-risk and are exposed only through the unsafe Metidos terminal path. |
| Unsafe | Turn on **Unsafe** in the access controls only when you intentionally want broader execution. | Unsafe mode enables bash and allows unsafe child threads/cron jobs. |

Gmail plugin setup: approve the Gmail core plugin in Settings -> Plugins, provide the `client_id` and `client_secret` Plugin Settings or env `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET`, save the local Gmail `refresh_token` Plugin Setting, then enable either **Gmail - Read** or **Gmail - Drafts only** per thread. The plugin uses direct Google OAuth and Gmail REST fetches rather than the Google API package, and it cannot send email from Metidos.

### Local startup modes

Metidos runs one Bun server that serves the browser app, auth routes, websocket RPC endpoint, and versioned frontend assets from the same process. It listens on loopback (`127.0.0.1`) rather than binding directly to the public network.

| Mode | Command | Use when |
|------|---------|----------|
| Local HTTP | `bun run start` | Normal local use on `http://localhost:7599`. |
| Local HTTP + telemetry | `bun run start:telemetry` | Same as above, but also persists runtime telemetry snapshots. |
| Local dev | `bun run dev` | Active local development with CSS watch and dev reload behavior. |
| Custom port | `METIDOS_PORT=7605 bun run start` or `bun run src/bun/index.ts --port 7605` | You want the Bun backend on a different loopback port. |
| Reverse-proxy TLS | `bun run start:tls` | Nginx or another reverse proxy terminates TLS and forwards to Bun over loopback HTTP. |
| Reverse-proxy TLS + telemetry | `bun run start:tls:telemetry` | Reverse-proxy TLS mode plus runtime telemetry persistence. |

Quick notes:

- The default backend port is `7599`.
- Bun serves on loopback only, so the reverse proxy target is the local Bun server, typically `http://127.0.0.1:7599`.
- `start:tls` does **not** make Bun terminate TLS itself. It tells Metidos to treat the public/browser-facing transport as `https://` and `wss://` while the reverse proxy handles certificates.
- After changing `.env` or provider env vars, restart Metidos.

Typical local startup:

```bash
bun run start
```

Then open `http://localhost:7599` in your browser. After startup, open **Settings** to verify provider status, then create a thread using a model from one of the enabled providers.

### Environment and startup flags

- `--port` / `-p` or `METIDOS_PORT` for custom server port selection.
- `--backend-only` or `METIDOS_BACKEND_ONLY=1` to restrict backend mode.
- `--dev` or `METIDOS_DEV=1` for development reconnect behavior and refresh hooks.
- `--tls` or `METIDOS_TLS=1` when browser-facing traffic is behind a TLS-terminating reverse proxy. This is reverse-proxy mode, not direct certificate termination inside Bun.
- `--track-telemetry` to persist periodic runtime-stat snapshots into a separate sidecar SQLite database under the app-data directory.
- `--wipe-user-data` to confirm, delete the local SQLite database files (including the telemetry sidecar DB when present), and exit before startup.
- `METIDOS_ALLOWED_WS_ORIGINS` for extra browser origins when you proxy through a non-default host or port.
- `METIDOS_PUBLIC_ORIGIN` as the primary browser-facing origin used by reverse-proxy TLS mode; the backend automatically adds it to the websocket allowlist. The built-in localhost websocket origins are for same-host development and trusted local proxy defaults, not a replacement for this public origin.
- `METIDOS_TRUST_PROXY=true` to trust `X-Forwarded-Host` and `X-Forwarded-Proto` from a reverse proxy that is the only public path to Bun. Leave unset for direct/local HTTP.
- `METIDOS_TRUSTED_PROXY_PEERS` when `METIDOS_TRUST_PROXY=true` and the proxy peer is not loopback. Set this to the explicit proxy IP/CIDR allowlist before relying on forwarded client IPs for public-route rate limits.
- `METIDOS_APP_DATA_DIR` for an explicit application data location for this local installation.
- `METIDOS_MAINVIEW_SOURCEMAP=1` to emit and serve the versioned mainview sourcemap path (for example `/assets/mainview/<version>/index.js.map`) for non-dev builds when you need production bundle debugging.

For local startup, Bun auto-loads `.env`; copy `.env.example` to `.env` and set `METIDOS_PUBLIC_ORIGIN=https://metidos.example.com` when you want the reverse-proxy TLS scripts to accept that host. `METIDOS_ALLOWED_WS_ORIGINS` accepts a comma-, space-, or newline-separated list when you need more than one browser-facing origin.

### Detailed reverse-proxy TLS reference

Metidos does **not** terminate TLS itself. `bun run start:tls` means:

- the public site is served over `https://...`
- websocket RPC is served publicly as `wss://.../rpc`
- nginx, Caddy, or another reverse proxy owns the certificate and TLS handshake
- the Bun backend still listens on loopback HTTP, usually `http://127.0.0.1:7599`

If you proxy HTTPS traffic to Metidos without enabling reverse-proxy TLS mode, `METIDOS_PUBLIC_ORIGIN`, and explicit proxy-header trust when needed, auth-origin checks and websocket-origin checks are much more likely to fail. Treat implicit localhost websocket origins as a same-machine trust assumption; do not rely on them as the public-origin configuration for TLS deployments.

Required pieces:

1. Start Bun in reverse-proxy TLS mode, for example `METIDOS_PORT=7599 bun run start:tls`.
2. Set the exact browser-facing origin in `.env`, for example `METIDOS_PUBLIC_ORIGIN=https://metidos.example.com`; include non-default public ports exactly, such as `https://metidos.example.com:8443`.
3. Enable proxy-header trust only for a trusted edge proxy with `METIDOS_TRUST_PROXY=true` and an explicit `METIDOS_TRUSTED_PROXY_PEERS` allowlist.
4. Proxy the app and websocket through the same public origin. At minimum, proxy `/`, `/auth/*`, `/rpc`, and `/assets/mainview/*`; the simplest setup proxies the whole site to Bun and gives `/rpc` websocket-friendly handling.
5. Preserve `Host`, `X-Forwarded-Host`, `X-Forwarded-Proto`, and, when public calendar routes need client attribution, `X-Forwarded-For`. Strip client-supplied `X-Forwarded-*` values at the public edge and set them explicitly in the proxy config.

Example `.env` for TLS:

```bash
METIDOS_PUBLIC_ORIGIN=https://metidos.example.com
METIDOS_TRUST_PROXY=true
METIDOS_TRUSTED_PROXY_PEERS=127.0.0.1
# METIDOS_ALLOWED_WS_ORIGINS=https://metidos-alt.example.com https://metidos.example.net
# METIDOS_PORT=7599
```

Recommended nginx shape:

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

upstream metidos_backend {
    server 127.0.0.1:7599;
    keepalive 32;
}

upstream metidos_share_worker {
    server 127.0.0.1:7600;
    keepalive 16;
}

server {
    listen 80;
    server_name metidos.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name metidos.example.com;

    ssl_certificate /etc/letsencrypt/live/metidos.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/metidos.example.com/privkey.pem;

    client_max_body_size 32m;

    location /rpc {
        proxy_pass http://metidos_backend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_read_timeout 3600;
        proxy_send_timeout 3600;
        proxy_buffering off;
    }

    location /share/open/ {
        proxy_pass http://metidos_share_worker;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 3600;
        proxy_send_timeout 3600;
        proxy_buffering off;
    }

    location /s/ {
        proxy_pass http://metidos_share_worker;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 3600;
        proxy_send_timeout 3600;
        proxy_buffering off;
    }

    location / {
        proxy_pass http://metidos_backend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 3600;
        proxy_send_timeout 3600;
    }
}
```

Nginx notes:

- `proxy_pass http://metidos_backend;` sends requests to the main Bun server on loopback.
- `proxy_pass http://metidos_share_worker;` on `/share/open/` and `/s/` sends stable hosted-web-server share traffic to the dedicated share worker.
- `Host` preserves the public host name. With `METIDOS_TRUST_PROXY=true`, `X-Forwarded-Host` also preserves it so Metidos can validate auth, share, and websocket origins correctly.
- With `METIDOS_TRUST_PROXY=true`, `X-Forwarded-Proto $scheme` tells Metidos whether the browser-facing request was `http` or `https`; in TLS mode this should normally be `https`.
- With `METIDOS_TRUST_PROXY=true`, `X-Forwarded-For` is used for public calendar ICS rate-limit attribution only when the direct proxy peer is trusted.
- `location /rpc` uses `proxy_http_version 1.1`, `Upgrade`, and `Connection` so websocket upgrade requests succeed.
- `proxy_buffering off` on `/rpc`, `/share/open/`, and `/s/` avoids websocket or progressive-stream weirdness through buffered proxy behavior.
- The ordinary `location /` block is enough for the app shell, auth routes, and versioned assets because Bun serves all of them; only the stable share routes need their own upstream.

TLS startup checklist:

1. Put the public origin in `.env`, for example `METIDOS_PUBLIC_ORIGIN=https://metidos.example.com`.
2. Enable proxy-header trust in `.env` when nginx is the trusted edge proxy: `METIDOS_TRUST_PROXY=true`.
3. Start Metidos in reverse-proxy TLS mode: `bun run start:tls`.
4. Point nginx at the Bun loopback port, usually `127.0.0.1:7599`.
5. Reload nginx.
6. Open the public HTTPS origin in a browser.
7. Confirm login works and the UI connects to `/rpc` successfully.
8. If public calendar ICS routes are exposed, confirm `METIDOS_TRUSTED_PROXY_PEERS` covers the direct proxy peer so ICS rate limits use the browser client IP rather than the proxy IP.

Common mistakes and symptoms:

| Symptom | Likely cause |
|---------|--------------|
| `Auth request origin not allowed.` | `METIDOS_PUBLIC_ORIGIN` does not match the real browser origin, or `METIDOS_TRUST_PROXY=true` is missing when nginx is expected to supply `X-Forwarded-Host` / `X-Forwarded-Proto`. |
| `WebSocket origin not allowed` on `/rpc` | Same as above, or you are serving from an alternate browser origin without adding it to `METIDOS_ALLOWED_WS_ORIGINS`. The implicit localhost websocket origins only cover same-host development/trusted local proxies. |
| The app loads but never connects to `/rpc` | nginx is not sending websocket upgrade headers, or `/rpc` is not using `proxy_http_version 1.1`. |
| Login/session cookies behave incorrectly behind HTTPS | Bun was not started with `start:tls` / `--tls`, or `METIDOS_TRUST_PROXY=true` is missing when nginx is expected to supply `X-Forwarded-Proto=https`. |
| You proxied only `/rpc` and left the rest elsewhere | Metidos expects the app shell, auth routes, assets, and websocket to live behind the same browser-facing origin. |

For a different loopback port, change both startup and nginx upstream, for example `METIDOS_PORT=7605 bun run start:tls` and `server 127.0.0.1:7605;`. For a non-default public HTTPS port, include it exactly in `METIDOS_PUBLIC_ORIGIN`, for example `https://metidos.example.com:8443`.

## Condensed question checklist

Use this as the canonical installer prompt list.

1. Are we installing now, exporting a plan, or updating an existing install?
2. Recommended or advanced mode?
3. How would you like to install: Docker, Podman, or source?
4. If container selected, which one to use: Docker or Podman?
5. Source path (source mode) or checkout path to use?
6. Container name?
7. Image tag?
8. Production-style or development container?
9. App data path?
10. Plugin path?
11. Cache path?
12. Env file path?
13. Backup/log paths?
14. Which project directories may Metidos access?
15. Project mount mode: read/write or read-only?
16. Host port?
17. Bind address?
18. Bun/Zig version pinning?
19. Do you have an active Codex subscription?
20. Import existing Codex or install via npm?
21. Enable Codex plugin by default?
22. Which core plugins: recommended, minimal, or manual?
23. Do you have custom APIs to connect now?
24. Did you request unsupported harnesses (Claude Code, Cursor, etc.)?
25. How should unsupported harness requests be handled?
26. Provide one comma-separated list of built-in model provider plugin IDs (or `none`).
27. If custom model/chat APIs are needed, provide one compact list of specs now (or `none`).
28. Generate a custom provider plugin if needed?
29. What services and tools should agents be able to use?
30. Do you want Chromium web browsing support?
31. Do you have any ICS URLs to import?
32. Which API key/env var names should be available?
33. For each env var: pass-through, env file, or placeholder?
34. Which plugins/services receive each env var?
35. Integrate Telegram?
36. Telegram mode: polling/webhook, chat ids, capabilities?
37. Integrate Gmail?
38. Gmail mode, OAuth credentials, scopes, account, approval policy?
39. Default safety/permission profile?
40. Enable cron/background agents?
41. Updates, backups, logs, telemetry?
42. Access method: localhost, reverse proxy, Tailscale, or both?
43. Reverse proxy details, if selected?
44. Tailscale details, if selected?
45. Review final plan: install, export only, edit, or cancel?

## Failure and recovery guidance

- If Docker/Podman is unavailable, stop and install it first.
- If image build fails, keep `metidos-config.md`, fix base image dependencies, and rerun from the correct container step.
- If plugin validation fails, do not install that plugin; return to plugin authoring workflow.
- If a secret is missing, write a placeholder and mark validation blocked.
- If reverse proxy TLS fails, fall back to localhost or Tailscale while DNS/certificates are fixed.
- If Tailscale access fails, verify login, ACLs, MagicDNS, host firewall, and bind strategy.
- If OAuth callback validation fails, revisit Step 18 and align external URL, callback path, and provider console settings.
