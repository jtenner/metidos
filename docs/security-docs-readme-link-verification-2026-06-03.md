# Security docs README link verification — 2026-06-03

## Scope

Verify the final pre-public checklist item: security docs are present and linked from the root README.

## Evidence

- `SECURITY.md` is present at the repository root and documents the supported pre-1.0 policy, private disclosure email, data that must not be shared publicly, expected disclosure process, and links to the deeper security model docs.
- `docs/security-model.md` is present and linked from the root README's Security model summary and Useful reference docs sections.
- `docs/security/threat-model.md` is present and linked from both `SECURITY.md` and `docs/README.md`.
- The root `README.md` Useful reference docs section links `SUPPORT.md`, `SECURITY.md`, and `ROADMAP.md` together, making the disclosure policy discoverable from the public landing page.
- `docs/README.md` links `SECURITY.md` in the Community and governance section and links the security model and threat model in Configuration and safety.

## Result

Pass. The security policy, security model, and threat model are checked in and reachable from the public README/documentation index. No content changes were required for this verification slice.
