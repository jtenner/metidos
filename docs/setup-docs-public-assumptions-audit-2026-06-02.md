# Setup docs public-assumptions audit — 2026-06-02

This note completes the public-readiness TODO to verify that setup documentation does not require private knowledge, private package access, personal paths, or internal services.

## Scope reviewed

Install-facing and setup-supporting sources reviewed in this slice:

- `README.md`
- `INSTALLATION.md`
- `docs/installation.md`
- `docs/getting-started.md`
- `docs/troubleshooting.md`
- `docs/operator-runbook.md`
- `deploy/podman/README.md`
- `docs/install-setup-smoke-gap-audit-2026-06-02.md`

## Checks performed

- Read the canonical setup path and compatibility entry points.
- Grepped setup-facing Markdown for personal paths and internal markers, including `jtenner`, `/home/`, `jt-ide`, `private`, `internal`, `YOUR_ORG`, `localhost`, and `example.com`.
- Reviewed each match to distinguish safe placeholders and privacy warnings from hidden private dependencies.

## Findings

No setup step requires private package access, a personal host path, an internal service, or machine-specific knowledge that is unavailable to an outside contributor.

The remaining matches are acceptable public documentation patterns:

- `README.md` uses the public GitHub repository URL in badge links.
- `INSTALLATION.md` uses `https://github.com/YOUR_ORG_OR_USER/metidos.git` as a placeholder clone URL, `localhost` for local-first startup, and `metidos.example.com` for reverse-proxy examples.
- `INSTALLATION.md`, `docs/troubleshooting.md`, and `deploy/podman/README.md` refer to private `.env`, App Data, provider credentials, and local/private providers as safety guidance, not as required private resources.
- `deploy/podman/README.md` uses placeholders such as `/path/to/host/.metidos-app-data`, `YOUR_USER`, and `https://device.tailnet.ts.net` for operator-specific values and explicitly directs machine-specific files into ignored local files.

## Outcome

The setup docs are contributor-readable and do not depend on private repository state or internal infrastructure. Further public-readiness work should focus on executing the outstanding smoke tests rather than rewriting setup docs for this concern.
