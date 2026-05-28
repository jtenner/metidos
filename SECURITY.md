# Security Policy

Metidos is local, operator-owned software that can access projects, run agent tools, call model providers, execute approved plugins, and schedule future work. Treat it as powerful development software.

## Supported versions

Metidos is currently pre-1.0. Security fixes are expected to target the default branch until a stable release policy exists.

## Responsible disclosure

Please report vulnerabilities privately by emailing:

<tenner.joshua@gmail.com>

Include as much of the following as you can safely share:

- affected Metidos commit or version,
- operating system and Bun version,
- affected component,
- reproduction steps,
- impact assessment,
- sanitized logs, screenshots, or proof-of-concept details.

## Please do not disclose publicly

Do not open a public issue or discussion for suspected vulnerabilities until there is a coordinated disclosure plan.

Do not include:

- API keys, OAuth tokens, cookies, sessions, WebSocket tickets, recovery codes, or TOTP secrets,
- full `.env` files,
- private repository URLs,
- local database files,
- plugin `.data` or `.logs` with unknown contents,
- screenshots showing private repositories, usernames, hostnames, local absolute paths, customer data, or tokens.

## Expected process

1. Send the private report by email.
2. Wait for acknowledgement before publishing details.
3. Work with the maintainer on reproduction, impact, and fix validation when needed.
4. Public notes should avoid exploit details until users have had reasonable time to update.

## Security model

See [`docs/security-model.md`](docs/security-model.md) and [`docs/security/threat-model.md`](docs/security/threat-model.md) for the current local-auth, plugin, filesystem, network, and data-handling model.
