# `.pi/skills/` Public Readiness Audit — 2026-06-02

Scope: `.pi/skills/**` in the working tree, including skill prompts, helper files, vendored third-party skills, and installation assets. This audit decides which skills are appropriate to ship publicly, which need redaction, and which should be excluded before making the repository public.

## Checks performed

- Inventoried every file under `.pi/skills/` (`find .pi/skills -type f | sort`): 67 files, 4,926 total lines.
- Read the top-level skill inventory and third-party attribution files.
- Reviewed skill names, descriptions, and adjacent helper assets.
- Searched the tree for common sensitive markers and publication risks: local home paths, maintainer username, secret/token/password/API-key terms, private/internal/customer references, GitHub issue automation, and TODO/FIXME markers.
- Verified the Matt Pocock vendored skills have explicit MIT attribution in `.pi/skills/THIRD_PARTY.md` and the full license in `.pi/skills/mattpocock-skills-LICENSE`.

## Decision summary

| Decision | Skill paths | Notes |
| --- | --- | --- |
| Ship publicly as repo-owned Metidos skills | `.pi/skills/a11y/`, `.pi/skills/commit/`, `.pi/skills/handoff/`, `.pi/skills/metidos-installation/`, `.pi/skills/metidos-plugin-authoring/`, `.pi/skills/research/`, `.pi/skills/inclusive-design-skills/**` | Appropriate for a public Metidos repository. They describe repository workflows, installation, plugin authoring, research/wiki maintenance, and accessibility review. No checked-in secret values or private host paths were found in this scope. |
| Ship publicly as vendored third-party skills | `.pi/skills/grill-me/`, `.pi/skills/improve-codebase-architecture/`, `.pi/skills/qa/`, `.pi/skills/to-prd/`, `.pi/skills/ubiquitous-language/` | Appropriate to redistribute with the existing MIT attribution and license files. Keep `.pi/skills/THIRD_PARTY.md` and `.pi/skills/mattpocock-skills-LICENSE` with any public release. |
| Redact before shipping | None identified | The sensitive-term hits were placeholders, examples, or secret-handling guidance rather than live credentials. |
| Exclude before shipping | None identified | No skill is inherently private-only or dependent on a personal machine path. |

## Notable reviewed findings

- `.pi/skills/metidos-installation/assets/docker/.env.docker.example` intentionally lists empty provider/API-key environment variable placeholders. These are safe to ship as examples because they do not contain values.
- `.pi/skills/metidos-installation/setup-otp.js` prints a newly generated local TOTP secret during setup. This is runtime behavior, not a checked-in secret. It is appropriate for a setup helper, and the surrounding skill repeatedly instructs agents not to write raw secrets into plans or chat.
- The Matt Pocock vendored skills contain generic examples such as customer/order/invoice domain language and GitHub issue workflows. They do not expose Metidos-private data.
- The inclusive-design and accessibility skills are generic review guidance and are appropriate for public contributor use.

## Required preservation notes

- Preserve `.pi/skills/THIRD_PARTY.md` and `.pi/skills/mattpocock-skills-LICENSE` whenever the vendored Matt Pocock skills are shipped.
- If new skills are added before publication, repeat this audit for the new paths rather than treating this decision as blanket approval for future skill content.
- This audit is limited to `.pi/skills/**`; it does not replace the separate repository-wide asset provenance review, working-tree secret scan, or Git-history secret scan.
