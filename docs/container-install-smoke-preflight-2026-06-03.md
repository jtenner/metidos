# Container install smoke preflight — 2026-06-03

This note records a disposable-container install smoke preflight for the public-readiness task "Smoke Docker and/or Podman install guidance in a disposable container."

## Scope

The intended smoke is to validate the checked-in Docker/Podman install guidance in a disposable container or container runtime, then record host OS, engine/version, commands, first-run auth outcome, provider expectations, backup/restore notes, teardown, and any corrections.

This run only completed the host/runtime preflight because no supported container engine is installed in the current recurring-agent environment.

## Environment observed

- Date: 2026-06-03
- Workspace: `/home/jtenner/Projects/jt-ide`
- Host kernel: `Linux bf28335b6a4b 6.12.90+deb13.1-amd64 #1 SMP PREEMPT_DYNAMIC Debian 6.12.90-2 (2026-05-27) x86_64 GNU/Linux`
- OS release: Debian GNU/Linux 13 (trixie), `VERSION_ID=13`, `DEBIAN_VERSION_FULL=13.4`
- Bun binary: `/usr/local/bin/bun`
- Local Bun version: `1.3.13`
- Repository package manager: `bun@1.3.14`

## Commands and output

```bash
uname -a
# Linux bf28335b6a4b 6.12.90+deb13.1-amd64 #1 SMP PREEMPT_DYNAMIC Debian 6.12.90-2 (2026-05-27) x86_64 GNU/Linux

lsb_release -a || cat /etc/os-release
# lsb_release: command not found
# PRETTY_NAME="Debian GNU/Linux 13 (trixie)"
# NAME="Debian GNU/Linux"
# VERSION_ID="13"
# VERSION="13 (trixie)"
# VERSION_CODENAME=trixie
# DEBIAN_VERSION_FULL=13.4
# ID=debian

command -v docker || true
# no output

docker --version || true
# /bin/bash: line 1: docker: command not found

command -v podman || true
# no output

podman --version || true
# /bin/bash: line 1: podman: command not found

command -v bun
# /usr/local/bin/bun

bun --version
# 1.3.13

node -e "const p=require('./package.json'); console.log(p.packageManager)"
# bun@1.3.14
```

## Result

Status: **blocked before container smoke execution**.

Neither Docker nor Podman is available in this host environment, so the install guidance could not be exercised in a disposable container during this run. The local Bun version also still differs from the repository `packageManager`, but that mismatch is secondary for this specific container-engine smoke because the selected blocker is the missing engine.

## Next actionable slice

On a machine or CI job with Docker or Podman installed:

1. Record `docker --version` and/or `podman --version` plus host OS details.
2. Follow the checked-in container setup guide, preferring `deploy/podman/README.md` for rootless Podman or the installer skill's Docker assets if Docker is selected.
3. Use disposable App Data, fake/demo Local Auth values, and no real provider credentials.
4. Record the exact commands, local URL/output, first-run Local Auth pass/fail result, provider-free/fake-provider expectations, backup/restore notes if covered, stop method, and teardown.
5. Commit sanitized evidence and any documentation corrections.
