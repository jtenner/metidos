# Metidos Podman Deployment

This is the reusable rootless Podman deployment guide. It runs Metidos in rootless Podman, stores app state in a Podman-managed named volume, exposes only a chosen host Projects folder to the container, and lets Tailscale provide HTTPS.

Machine-specific values belong in ignored local files such as `LOCAL.md`, `.env.podman`, and `compose.yml`. Use the checked-in `*.example` files as starting points.

## Deployment shape

| Fact | Value |
|------|-------|
| App data inside container | `/data` (backed by Podman named volume `metidos-data`) |
| Host project mount | `${METIDOS_HOST_PROJECTS_DIR}:${METIDOS_CONTAINER_PROJECTS_DIR}` (defaults to `/home/metidos/Projects` inside the container) |
| Runtime source checkout | `${METIDOS_CONTAINER_SOURCE_DIR}` when self-updating; otherwise `/app` as a build-time snapshot fallback |
| Container `node_modules` | Podman named volume `metidos-source-node-modules` |
| Local container port | `127.0.0.1:7599` |
| Container listener | `0.0.0.0:7599`, published only on host loopback |
| Tailscale origin | your `https://device.tailnet.ts.net` DNS name |

Auth mounts (enable only the ones you need in your ignored local `compose.yml`):

- Codex: `${CODEX_AUTH_JSON}:/data/plugins/codex/.data/auth.json:ro`
- GitHub Copilot: `${GITHUB_COPILOT_AUTH_JSON}:/data/plugins/github_copilot/.data/auth.json:ro`
- GitHub CLI: `/data/gh` inside the app-data volume, imported from the host with `gh auth token` when needed.

## Optional image toolchains

The base image always includes Bun, Git, Node.js, Python, basic build tools, and the interactive shell. You can optionally include additional toolchains at build time so agents do not need to install them at runtime:

- **Browser automation** — Debian `chromium` and `chromium-sandbox`, with `BUN_CHROME_PATH=/usr/bin/chromium` and a headless Chrome DevTools Protocol listener on container loopback (`127.0.0.1:9222`).
- **GitHub CLI** — `gh` from the Debian package repository.
- **Go toolchain** — Debian `golang-go`, with `GOPATH=/home/metidos/go` and `$GOPATH/bin` on `PATH` for installed Go commands.
- **Document toolchain** — `latexmk`, TeX Live LaTeX packages, and `poppler-utils`.
- **MoonBit toolchain and proof dependencies** — MoonBit `0.9.3+b53c2807d` under `/opt/moonbit`, plus an image-global `/opt/opam` root with the `moonbit-proof` switch active by default, containing Why3 1.8.2 and Alt-Ergo 2.6.3. Startup runs `why3 config detect` when `$HOME/.why3.conf` is missing.
- **WebAssembly tooling** — `wasm-tools 1.251.0` and Binaryen `version_130` under `/opt/binaryen-version_130` with tools such as `wasm-opt` symlinked into `/usr/local/bin`.
- **Interactive shell** — the entrypoint creates `$HOME/.bashrc` when missing and sets a prompt that includes the current working directory. If you use MoonBit, wire `MOONBIT_BIN_DIR` into the compose `PATH` so terminals and login shells can find the compiler.

Choose which toolchains to include when running the installer or editing `deploy/podman/.env.podman`. The compose template passes these build args to the `Containerfile` and they all default to `false`:

```env
INSTALL_CHROMIUM=false
INSTALL_GH=false
INSTALL_GO=false
INSTALL_LATEX=false
INSTALL_RUST=false
INSTALL_MOONBIT=false
INSTALL_WASM_TOOLS=false
```

Only install the toolchains your projects need. Set `BUN_CHROME_PATH=/usr/bin/chromium` and `METIDOS_CHROME_DEBUG_PORT=9222` only when `INSTALL_CHROMIUM=true` and browser automation is approved.

If you migrate an existing host database, prune or rewrite project paths so they still exist inside the container after the Projects mount is applied. Record machine-specific retained paths in `deploy/podman/LOCAL.md`, not in this generic guide.

## `/data` Recommendation

Use `/data` only as the container's internal app-data path, backed by the
`metidos-data` Podman named volume. Do not bind-mount a host `/data` directory.
That keeps host exposure limited to the Projects folder and the read-only Codex
auth file, and avoids UID/label friction from direct host directory mounts.

When `METIDOS_CONTAINER_SOURCE_DIR` is set, the running service uses the mounted checkout as `METIDOS_SOURCE_DIR`. The image still contains a copied `/app` fallback, but `/app` is only a snapshot from image build time. Runtime dependency installs go into the `metidos-source-node-modules` named volume mounted at `${METIDOS_CONTAINER_SOURCE_DIR}/node_modules`, so the container can update dependencies without exposing another host folder.

## One-Time Setup

Create the local env and compose files:

```bash
cp deploy/podman/.env.podman.example deploy/podman/.env.podman
cp deploy/podman/compose.example.yml deploy/podman/compose.yml
```

Edit `deploy/podman/compose.yml` for host-specific mounts, container names, volume names, and optional auth mounts. The local compose file is intentionally ignored by Git.

Add provider keys directly to `deploy/podman/.env.podman` when they should be
available to Metidos after user-service restarts. Do not rely on interactive
shell exports for systemd-started containers. The example compose file keeps
GitHub Copilot and SSH credential mounts commented out; enable only the mounts
you need in your ignored local `compose.yml`.

If you need MoonBit tooling, set `INSTALL_MOONBIT=true` and leave `MOONBIT_BIN_DIR=/opt/moonbit/bin` unless you intentionally mount an external MoonBit toolchain. To override it, set `MOONBIT_BIN_DIR` in `deploy/podman/.env.podman` to the directory that contains `moon`, `moonc`, and `moonrun`, then prepend it to `PATH` in your ignored local compose file.

For host Ollama access, the compose template enables `slirp4netns:allow_host_loopback=true`, defaults `OLLAMA_BASE_URL` to `http://10.0.2.2:11434`, and defaults `METIDOS_PLUGIN_UNSAFE_PRIVATE_NETWORK_PLUGINS=ollama`. The Ollama core plugin must be approved with its `unsafe` permission before plugin-sidecar fetches can reach that private host-loopback address.

Stop the current host Metidos process before copying app data. Nginx can stay
installed, but it should not stay active on port `443` if Tailscale Serve is
the browser-facing HTTPS path.

Build the image:

```bash
podman compose --env-file deploy/podman/.env.podman -f deploy/podman/compose.yml build
```

Copy and prune the current host app data into the Podman volume:

```bash
podman volume create metidos-data
podman run --rm \
  -v metidos-data:/data:U \
  -v /path/to/host/.metidos-app-data:/source:ro \
  localhost/metidos:podman \
  bun run deploy/podman/migrate-app-data.ts --source /source --target /data --force
```

Start Metidos:

```bash
podman compose --env-file deploy/podman/.env.podman -f deploy/podman/compose.yml up -d
```

The entrypoint starts from `METIDOS_CONTAINER_SOURCE_DIR`, not `/app`, and runs
`bun install --frozen-lockfile` into the container-managed `node_modules` volume
when `METIDOS_INSTALL_DEPS_ON_START=1`.

The entrypoint also creates a default `$HOME/.bashrc` only when one is missing.
Keep that default for new installs unless you have a deliberate custom prompt;
admin terminals should show the current working directory, not only `#` or `$`.

The entrypoint starts headless Chromium for Chrome DevTools Protocol access when
`METIDOS_CHROME_DEBUG_PORT` is set. Chromium itself listens on container
loopback at `127.0.0.1:${METIDOS_CHROME_DEBUG_BACKEND_PORT:-19222}`, and a
small proxy exposes it inside the container on `0.0.0.0:9222`. Compose publishes
only the Metidos app port; the Chrome DevTools Protocol endpoint stays inside
the container. Set
`METIDOS_CHROME_DEBUG_PORT=` in `deploy/podman/.env.podman` to disable the
debug browser. Startup clears stale Chromium `Singleton*` profile locks from the
persisted debug profile directory before launching the browser.

After changing files under this repository, restart the running container
without remigrating `/data` or rebuilding the image:

```bash
scripts/restart-podman-metidos.sh
```

Rebuild only when the image itself changed, such as `Containerfile`,
`entrypoint.sh`, or system packages:

```bash
scripts/restart-podman-metidos.sh --build
```

## Updating From Inside The Container

Agents running inside Metidos should edit or pull the mounted checkout, not
`/app`:

```bash
cd "$METIDOS_CONTAINER_SOURCE_DIR"
git status --short --branch
```

To restart Metidos from inside the container after updating the checkout:

```bash
scripts/restart-metidos-in-container.sh
```

That script does not need access to the Podman socket. It terminates container
PID 1, and the `restart: unless-stopped` policy starts the container again
against the mounted checkout.

Serve it through Tailscale HTTPS:

```bash
tailscale serve --bg --https=443 http://127.0.0.1:7599
tailscale serve status
```

If Tailscale denies the serve config for the current user, run this once and
then rerun the serve command:

```bash
sudo tailscale set --operator=<your-user>
```

If nginx was previously serving Metidos, disable it before relying on the
Tailscale URL:

```bash
sudo systemctl disable --now nginx
tailscale serve --bg --https=443 http://127.0.0.1:7599
```

Open this URL from any device joined to the same tailnet:

```text
https://device.tailnet.ts.net
```

Use the `https://...ts.net` DNS name, not the `100.x.x.x` Tailscale IP. The DNS
name is what matches `METIDOS_PUBLIC_ORIGIN`, TLS, and websocket origin checks.

## Always-On Startup

Install the user service:

```bash
mkdir -p ~/.config/systemd/user
cp deploy/podman/metidos-podman.service.example ~/.config/systemd/user/metidos-podman.service
systemctl --user daemon-reload
systemctl --user enable --now metidos-podman.service
sudo loginctl enable-linger YOUR_USER
```

Check service state:

```bash
systemctl --user status metidos-podman.service
podman compose --env-file deploy/podman/.env.podman -f deploy/podman/compose.yml logs -f metidos
```

Run the `systemctl --user ...` commands from a normal logged-in terminal if an
automation shell cannot connect to the user systemd bus.

Verify linger after setup:

```bash
loginctl show-user YOUR_USER -p Linger
```

The expected output is `Linger=yes`.

## Validation

Check the local container path:

```bash
podman compose --env-file deploy/podman/.env.podman -f deploy/podman/compose.yml ps
curl -fsS http://127.0.0.1:7599/ >/tmp/metidos-local-check.html
```

Check Tailscale Serve:

```bash
tailscale serve status
curl -fsS https://device.tailnet.ts.net/ >/tmp/metidos-tailscale-check.html
```

Expected `tailscale serve status` shape:

```text
https://device.tailnet.ts.net (tailnet only)
|-- / proxy http://127.0.0.1:7599
```

Verify the active container still has only the intended host-facing mounts:

```bash
podman compose --env-file deploy/podman/.env.podman -f deploy/podman/compose.yml exec -T metidos sh -lc 'mount | grep -E "(/home/.*/Projects|/data/plugins/codex/.data/auth.json|/data)"'
```

The Codex auth mount should show `ro`, and the host project mount should match the container Projects path configured in Compose.

Check provider env visibility without printing secret values:

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

If a key is present in the host shell but missing inside the container, copy it
into `deploy/podman/.env.podman` and recreate the service:

```bash
podman compose --env-file deploy/podman/.env.podman -f deploy/podman/compose.yml up -d
```

Verify the admin terminal Bash prompt:

```bash
podman compose --env-file deploy/podman/.env.podman -f deploy/podman/compose.yml exec -T metidos bash -ic 'printf "%s\n" "$PS1"'
```

The prompt definition should include the current working directory, such as
`\w`.

Verify Chrome DevTools Protocol support for browser plugins:

```bash
podman compose --env-file deploy/podman/.env.podman -f deploy/podman/compose.yml exec -T metidos bash -lc 'command -v chromium; printf "%s\n" "$BUN_CHROME_PATH"; wget -qO- http://127.0.0.1:${METIDOS_CHROME_DEBUG_PORT:-9222}/json/version'
```

The JSON response should include a `webSocketDebuggerUrl`.

## Notes

- Do not mount an entire host home directory into the container.
- Do not mount the whole `.codex` directory. Only `auth.json` is mounted, and it
  is read-only.
- Do not edit `/app` for durable changes. `/app` is the image snapshot; use the mounted checkout configured by `METIDOS_CONTAINER_SOURCE_DIR`.
- Use `scripts/restart-podman-metidos.sh --build` after image or entrypoint
  changes so the copied `/app` fallback and entrypoint stay current.
- If Tailscale reports a stale serve config, clear it with
  `tailscale serve reset` and rerun the `tailscale serve --bg ...` command.
- If `curl -v https://device.tailnet.ts.net/` shows `server: nginx` or a
  certificate with `CN=localhost`, nginx is still intercepting HTTPS on `443`.
- If `curl http://127.0.0.1:7599/` resets while the container logs say Metidos
  is listening, confirm the Compose service sets `METIDOS_SERVER_HOST=0.0.0.0`
  and `METIDOS_SERVER_ALLOW_PUBLIC_BIND=1`. The host port should still be
  published only on `127.0.0.1`.
- If an admin terminal shows only `#` or `$`, check `$HOME/.bashrc` inside the
  container. Recreate the container if the file is missing, or update the custom
  file so interactive `PS1` includes the current working directory.
- If a model provider reports a missing API-key header, check the key inside the
  container with the provider env verification command above. The app process
  only sees env vars present when the container starts.
