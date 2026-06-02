# Security threat model

This threat model summarizes the main assets, boundaries, attackers, abuse cases, and mitigations for a local Metidos installation.

## Scope

In scope:

- local Backend and Mainview,
- Local Auth and `/rpc` WebSocket access,
- App Data,
- Projects and Worktrees,
- Pi-powered Threads,
- Cron Jobs,
- Plugin System v1,
- model/provider configuration,
- reverse-proxy/Tailscale-style access,
- logs, diagnostics, and telemetry sidecars.

Out of scope for this document:

- security of external model providers,
- security of third-party Git hosting services,
- operating-system compromise below the Metidos process,
- malicious physical access to an unlocked operator machine.

## Assets

High-value assets include:

- provider API keys and OAuth tokens,
- Local Auth primary factor hashes/secrets, TOTP secrets, recovery codes, Sessions, and WebSocket Tickets,
- App Data SQLite databases,
- Pi runtime sessions and Thread history,
- project source code and uncommitted diffs,
- private repository URLs and branch names,
- plugin settings, `.data`, `.logs`, and review state,
- cron prompts and schedules,
- telemetry and diagnostics,
- reverse-proxy configuration and public origins.

## Trust boundaries

Important boundaries:

1. Browser to Backend over HTTP/WebSocket.
2. Authenticated Session and WebSocket Ticket boundary.
3. Mainview UI state versus Backend authorization.
4. Workspace Path Scope between allowed worktrees and the host filesystem.
5. Safe Mode versus Unsafe Mode runtime tool policy.
6. Plugin discovery/review versus sidecar execution.
7. Plugin virtual filesystem roots (`~/` and `./`).
8. Plugin network allowlists and private-network endpoints.
9. Provider Auth handoff to Pi or plugin providers.
10. Cron scheduler/runner creating future work.
11. Reverse proxy/TLS origin boundary.
12. App Data and backups outside version control.

## Attacker capabilities considered

- A website attempting cross-origin WebSocket or cookie abuse.
- A stale or stolen browser session.
- A malicious or compromised plugin folder.
- A plugin update that changes code after approval.
- A model/tool prompt causing the agent to request unsafe operations.
- A misconfigured Cron Job that repeats risky actions.
- A provider credential accidentally committed or pasted into an issue.
- A reverse proxy that forwards untrusted origin/header data.
- A symlink/traversal attempt against worktree or plugin file access.
- Excessive RPC messages causing local resource exhaustion.
- Logs or screenshots leaking private local data.

## Major abuse cases and mitigations

### Browser-origin abuse

Risk: another site tries to open `/rpc` or reuse browser cookies.

Mitigations:

- allowed-origin checks,
- short-lived WebSocket Tickets,
- Session revalidation for messages,
- close-on-auth-failure behavior,
- reverse-proxy origin configuration through `METIDOS_PUBLIC_ORIGIN` and allowed-origin env vars.

### Stale session use

Risk: a revoked or expired Session continues to perform actions.

Mitigations:

- per-message Session revalidation,
- session/user socket close helpers,
- logout/session revocation cleanup,
- policy-code socket closure on auth failures.

### Plugin code execution without review

Risk: unreviewed plugin code runs automatically.

Mitigations:

- side-effect-free discovery,
- manifest validation,
- deterministic review hash,
- operator approval before activation,
- source changes invalidate approval,
- step-up authentication for approval/execution-sensitive actions.

### Plugin overreach

Risk: a plugin reads files, calls the network, or registers providers beyond its purpose.

Mitigations:

- manifest-declared permissions,
- file and network allowlists,
- virtual filesystem roots,
- symlink/traversal checks,
- private-network access treated as high risk,
- Settings review of permissions and declarations.

### Filesystem traversal or symlink escape

Risk: project or plugin file APIs escape intended roots.

Mitigations:

- Backend path normalization,
- realpath containment,
- virtual roots for plugin APIs,
- hard-denied sensitive paths,
- sanitized errors without sensitive host path disclosure.

### Unsafe runtime escalation

Risk: an agent gains shell or creates unsafe child work unexpectedly.

Mitigations:

- Safe Mode default,
- explicit Unsafe Mode permission,
- unsafe escalation checks for child Threads and Cron Jobs,
- UI warnings and access-control separation.

### Scheduled risky work

Risk: a Cron Job repeatedly performs a harmful action.

Mitigations:

- operator-owned schedule definitions,
- explicit Project/Worktree/model/Access Control selection,
- disable/delete lifecycle,
- run-now validation,
- run status and child Thread inspection,
- safe prompt guidance.

### Secret disclosure in issues or logs

Risk: credentials, recovery codes, private URLs, or local paths are shared publicly.

Mitigations:

- placeholder-only docs,
- `.env.example` without real secrets,
- safe issue-reporting guidance,
- Backend-controlled redaction where practical,
- warnings that plugin-authored logs/tool results may not be safe.

### Resource exhaustion over RPC

Risk: malformed or runaway clients overload the local server.

Mitigations:

- payload limits,
- pre-parse budget controls,
- per-client and global pending request caps,
- duplicate request rejection,
- rate limiting,
- cancellation and timeout handling,
- backpressure cleanup,
- runtime diagnostics.

### Reverse-proxy misconfiguration

Risk: public exposure bypasses assumptions about local use.

Mitigations:

- localhost-first guidance,
- exact `METIDOS_PUBLIC_ORIGIN`,
- constrained forwarded-origin handling,
- trust proxy only behind a trusted overwriting proxy,
- TLS termination at proxy,
- WebSocket upgrade guidance,
- Tailscale/private-network preference for early deployments.

### Public web-server share routes

Risk: a shared web-server route exposes hosted Thread content to anyone who receives or steals the share URL/session, or a cross-site page attempts to claim a share token or forward browser credentials through the share proxy.

Threat-model decision: `/share/open` and `/s/<thread>/<server>/...` are intentionally public share routes, not normal Local Auth routes. A claim token from the Metidos UI is exchanged once for a scoped share-session cookie; after that, route access is authorized by the share-session cookie matching the Thread and server IDs. This makes shared content available to token holders without requiring a Metidos account, so operators must treat share links as bearer-style access to the hosted content.

Mitigations:

- share routes bind to loopback by default and require explicit opt-in for non-loopback hosts,
- non-loopback share hosts require public TLS mode,
- `/share/open` accepts claim-token POSTs only from the same Origin or Referer as the share origin,
- claim tokens are hashed in App Data and consumed into scoped, expiring share-session cookies,
- `/s/*` routes require a valid share session whose Thread/server IDs match the route,
- the share proxy strips Metidos share cookies, `Authorization`, API-key, proxy, hop-by-hop, and disallowed upstream response headers,
- upstream redirects are rewritten back through the share route when they target the hosted loopback origin,
- request bodies, response bodies, open-route attempts, upstream timeouts, and per-share concurrent proxy fetches are bounded,
- the upstream server must prove ownership with the expected server-instance header before content is proxied.

Residual risk: anyone with a valid share session can view and interact with the hosted content until the share/session expires or the operator stops the shared server. Do not use web-server shares for private content unless the share URL is distributed only to intended recipients over trusted channels.

## Residual risks

- Approved plugins are still local code and may be malicious or vulnerable.
- Unsafe Mode intentionally broadens runtime capability.
- External model providers may retain or inspect prompts according to their own policies.
- Plugin-authored logs and tool outputs may leak secrets if plugin code writes them.
- A compromised operator OS or browser profile can bypass application-level protections.
- Backups contain sensitive state and require separate protection.

## Operator recommendations

- Keep Metidos local unless remote access is necessary.
- Use Safe Mode by default.
- Approve only plugins you understand.
- Re-review plugins after changes.
- Use least-privilege provider and plugin configuration.
- Back up App Data before upgrades or destructive actions.
- Redact issue reports aggressively.
- Rotate credentials that may have been exposed.
