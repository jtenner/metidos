# Remote access setup desk-check — 2026-06-02

This note records a documentation-only desk-check for the public-readiness TODO to smoke or desk-check reverse-proxy, Tailscale, and TLS setup guidance.

## Scope

Reviewed tracked setup/security/operator docs for the remote-access path. No live reverse proxy, Tailscale device, TLS certificate, or browser session was exercised in this slice.

Reviewed files:

- `INSTALLATION.md`
- `docs/troubleshooting.md`
- `docs/security-model.md`
- `docs/operator-runbook.md`
- `docs/security/threat-model.md`

## Checks reviewed

- `METIDOS_PUBLIC_ORIGIN` is documented as the exact browser-facing origin for reverse-proxy/TLS deployments.
- `/rpc` WebSocket upgrade forwarding is called out in setup and troubleshooting guidance.
- `METIDOS_ALLOWED_WS_ORIGINS` is documented for additional legitimate browser origins.
- `METIDOS_TRUST_PROXY=true` is constrained to trusted proxies that are the only public path to Bun and overwrite forwarded headers.
- `METIDOS_ALLOWED_FORWARDED_ORIGINS` and `METIDOS_TRUSTED_PROXY_PEERS` are documented where trust-proxy mode needs them.
- `bun run start:tls` is documented as a TLS-termination mode signal; it does not terminate TLS itself.
- Tailscale guidance says to use the DNS name matching `METIDOS_PUBLIC_ORIGIN`, not a raw `100.x.x.x` address.
- Troubleshooting includes a proxy-focused `/rpc` checklist covering origin, WebSocket, forwarded-origin, trusted-peer, and `start:tls` settings.

## Result

Pass as a desk-check only. The docs now consistently point operators at the same remote-access requirements and make clear which checks were reviewed rather than executed.

## Not executed

A future live smoke should still verify at least one disposable reverse-proxy or Tailscale setup end to end, including:

- proxy TLS termination,
- browser login over the public/Tailscale origin,
- `/rpc` WebSocket connection through the proxy,
- failure behavior when `METIDOS_PUBLIC_ORIGIN` or proxy upgrade settings are wrong,
- teardown without preserving private App Data, cookies, or credentials.
