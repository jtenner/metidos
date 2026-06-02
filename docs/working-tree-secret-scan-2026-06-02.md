# Working-Tree Secret Scan — 2026-06-02

## Scope

Scanned the current repository working tree at `/home/jtenner/Projects/jt-ide` for checked-in secrets before public/open-source publication.

Ignored paths followed the repository `.gitignore` via Secretlint's `--secretlintignore .gitignore` option. Local scan dependencies and raw JSON output were kept under `.tmp/`, which is ignored and was not committed.

## Tooling

- Tool: Secretlint 13.0.2
- Rule preset: `@secretlint/secretlint-rule-preset-recommend` 13.0.2
- Date: 2026-06-02

Command used:

```sh
mkdir -p .tmp
cat > .tmp/secretlintrc.json <<'EOF'
{
  "rules": [
    { "id": "@secretlint/secretlint-rule-preset-recommend" }
  ]
}
EOF

rm -rf .tmp/secret-scan
mkdir -p .tmp/secret-scan
cat > .tmp/secret-scan/package.json <<'EOF'
{"private":true,"devDependencies":{"secretlint":"13.0.2","@secretlint/secretlint-rule-preset-recommend":"13.0.2"}}
EOF

(cd .tmp/secret-scan && bun install)
.tmp/secret-scan/node_modules/.bin/secretlint \
  --secretlintrc .tmp/secretlintrc.json \
  "**/*" \
  --secretlintignore .gitignore \
  --format json \
  > .tmp/secretlint-working-tree-2026-06-02.json
```

Secretlint exited with status 1 because it reported findings. A follow-up parser counted 1,377 scanned files and 5 findings.

## Reviewed findings

| File | Rule | Review outcome |
| --- | --- | --- |
| `src/bun/calendar/store.test.ts` | `@secretlint/secretlint-rule-basicauth` | Test fixture URL intentionally includes fake `user:secret` credentials to assert external calendar URL validation rejects credentialed URLs. |
| `src/bun/plugin/inventory.test.ts` | `@secretlint/secretlint-rule-basicauth` | Test fixture allowlist intentionally includes fake `user:secret` credentials to assert plugin inventory validation flags credentialed network patterns. |
| `src/bun/plugin/manifest.test.ts` | `@secretlint/secretlint-rule-basicauth` | Test fixture allowlist intentionally includes fake `user:secret` credentials to assert manifest validation reports `credentialed_network_allow_pattern`. |
| `src/bun/plugin/network-allowlist.test.ts` | `@secretlint/secretlint-rule-basicauth` | Test fixture URLs intentionally include fake `user:secret` credentials to assert allowlist compilation and matching reject credentialed URLs. |

## Conclusion

The dedicated working-tree secret scan found only intentional fake credentials in tests that exercise rejection paths for credentialed URLs. No exposed real credentials were identified in this scan, and no credential rotation is required from these findings.

Remaining public-readiness security work includes a full Git-history secret scan and any follow-up rotation for exposed, suspicious, stale, or unverifiable credentials found by other audits.
