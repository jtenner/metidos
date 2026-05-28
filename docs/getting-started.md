# Getting started

This is the shortest clean-clone path to a useful Metidos session: install dependencies, start Metidos, finish first-run auth, add a project, start an agent thread, and review the resulting diff.

## Prerequisites

- Git.
- Bun matching the repository package-manager declaration. Verify it from a clean shell:

  ```bash
  bun --version
  node -e "const p=require('./package.json'); console.log(p.packageManager)"
  ```

  If the versions differ, install the Bun version printed by `package.json` before debugging application behavior.
- A modern browser.
- At least one model provider credential or a local/private provider such as Ollama. You can still open the UI without a provider, but agent turns need a configured model.

## 1. Clone and install

```bash
git clone https://github.com/YOUR_ORG_OR_USER/metidos.git
cd metidos
bun install --frozen-lockfile
```

Do not copy local `.env`, app databases, plugin `.data`, or other ignored runtime state from another machine. A clean clone should rely only on tracked source plus placeholder configuration.

## 2. Create safe local configuration

```bash
cp .env.example .env
```

Edit `.env` with placeholders replaced by values for your machine. Keep secrets out of screenshots and issue reports. Useful first-run values:

```bash
# Optional explicit app-data root. If omitted, Metidos uses the OS app-data location.
METIDOS_APP_DATA_DIR=/absolute/path/to/local/metidos-app-data

# Optional local port. If omitted, Metidos uses its default.
METIDOS_PORT=7599

# Optional provider keys. Use real values only in your private .env file.
OPENAI_API_KEY=replace-with-your-key
ANTHROPIC_API_KEY=replace-with-your-key
OPENROUTER_API_KEY=replace-with-your-key
```

`METIDOS_APP_DATA_DIR` stores local databases, auth material, Pi runtime sessions, plugin installations, plugin data, logs, and optional telemetry. Do not put it inside a repository you commit.

## 3. Start the development server

```bash
bun run dev
```

Open the printed localhost URL in your browser. For a production-like local run, use:

```bash
bun run start
```

Use `bun run start:tls` only when a trusted reverse proxy terminates HTTPS and forwards to Bun.

## 4. Finish first-run auth

On first launch, Metidos creates the local auth setup for the Local Operator. Follow the browser prompts to configure:

- a primary factor, such as a PIN or password,
- TOTP enrollment when prompted,
- recovery codes.

Save recovery codes somewhere private. Do not paste primary factors, TOTP secrets, recovery codes, cookies, WebSocket tickets, or `.env` contents into GitHub issues.

## 5. Configure a provider

Open Settings and configure the provider or plugin-backed provider you want to use. Use placeholder examples in docs and real values only in your private local configuration.

For local/private providers, confirm the provider endpoint is reachable from the Metidos process. For plugin-backed providers, approve the plugin before expecting it in the model catalog.

See [Model providers](./model-providers.md) for details.

## 6. Add your first project

1. In Mainview, choose the project/worktree area and add a project folder.
2. Select a Git worktree for that project.
3. Confirm the displayed path is the intended working tree before starting agent work.

Metidos treats a **Project** as the high-level entry point and a **Worktree** as the concrete Git checkout context used by tools and threads.

## 7. Start your first thread

1. Select the project and worktree.
2. Choose a provider-qualified model from the model selector.
3. Leave unsafe mode off for the first run.
4. Type a small request, for example: "Inspect this repository and summarize the test commands. Do not edit files."
5. Send the message and watch the Thread status.

A **Thread** is a Pi-powered agent execution session attached to the selected project/worktree. Each response cycle is a **Turn**.

## 8. Review diffs before keeping changes

If the agent edits files:

1. Open the diff workspace.
2. Review changed, added, deleted, renamed, and binary-file entries.
3. Use normal Git commands outside Metidos or Git tools inside an authorized Thread to commit only what you intend to keep.

## 9. Create a scheduled job later

After the first interactive thread works, try a small cron job in the cron workspace:

- give it a clear title,
- select the project/worktree,
- use a conservative schedule,
- keep unsafe mode off unless the job truly needs it,
- use Run now once before relying on the schedule.

See [Cron jobs](./cron.md).

## First-run smoke checklist

- [ ] `bun --version` matches `package.json`.
- [ ] `bun install --frozen-lockfile` succeeds from a clean clone.
- [ ] `bun run dev` or `bun run start` prints a local URL.
- [ ] First-run auth completes and recovery codes are saved privately.
- [ ] A provider appears in the model catalog.
- [ ] A project and worktree can be opened.
- [ ] A safe Thread can run and settle.
- [ ] Diff review shows expected file changes.
