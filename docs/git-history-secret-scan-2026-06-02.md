# Git-History Secret Scan — 2026-06-02

## Scope

Scanned Git history for checked-in secrets before public/open-source publication.

The scan covered all refs reachable from `git rev-list --objects --all` in `/home/jtenner/Projects/jt-ide` on 2026-06-02.

Raw scan exports and JSON output were kept under `.tmp/history-secret-scan/`, which is ignored and was not committed.

## Tooling

- Tool: Secretlint 13.0.2
- Rule preset: `@secretlint/secretlint-rule-preset-recommend` 13.0.2
- Date: 2026-06-02

Secretlint's normal `.gitignore` filtering was disabled for the exported historical blobs because the scan intentionally read ignored `.tmp/` exports.

## Method

The history scan exported each unique, reachable text blob to an ignored temporary directory, then ran Secretlint over those exported blob files.

Summary counts:

| Metric | Count |
| --- | ---: |
| Reachable commits | 247 |
| Reachable Git objects | 3,358 |
| Exported text blobs scanned by Secretlint | 2,025 |
| Skipped non-text or >1 MiB blobs | 10 |

The skipped blobs were binary or large media/font assets: `bird.png`, `docs/uploadthing-test.png`, `.wiki/raw/.gitkeep`, `src/mainview/crown.png`, `src/mainview/logo.png`, `src/mainview/pixel-crown.png`, and checked-in font files. Artwork provenance is tracked separately in `docs/public-asset-provenance-audit-2026-06-02.md`.

Commands used:

```sh
mkdir -p .tmp/history-secret-scan/blobs
git rev-list --objects --all > .tmp/history-secret-scan/rev-list-objects.txt
awk '{print $1}' .tmp/history-secret-scan/rev-list-objects.txt \
  | sort -u \
  > .tmp/history-secret-scan/object-oids.txt

while IFS= read -r oid; do
  type=$(git cat-file -t "$oid" 2>/dev/null || true)
  [ "$type" = "blob" ] || continue
  size=$(git cat-file -s "$oid")
  if [ "$size" -gt 1048576 ]; then
    echo "$oid $size large" >> .tmp/history-secret-scan/skipped-blobs.txt
    continue
  fi
  tmp=".tmp/history-secret-scan/blob.tmp"
  git cat-file -p "$oid" > "$tmp"
  if perl -0ne 'exit(index($_, "\0") >= 0 ? 0 : 1)' "$tmp"; then
    echo "$oid $size binary" >> .tmp/history-secret-scan/skipped-blobs.txt
    rm -f "$tmp"
    continue
  fi
  mv "$tmp" ".tmp/history-secret-scan/blobs/$oid.txt"
done < .tmp/history-secret-scan/object-oids.txt

mapfile -t files < <(find .tmp/history-secret-scan/blobs -type f -name '*.txt')
.tmp/secret-scan/node_modules/.bin/secretlint \
  --no-gitignore \
  --secretlintrc .tmp/secretlintrc.json \
  --format json \
  "${files[@]}" \
  > .tmp/history-secret-scan/secretlint-history-2026-06-02.json
```

Secretlint exited with status 1 because it reported findings. A parser counted 2,025 scanned text blobs and 10 findings across 9 historical blob versions.

## Reviewed findings

| Historical path | Rule | Review outcome |
| --- | --- | --- |
| `src/bun/calendar/store.test.ts` | `@secretlint/secretlint-rule-basicauth` | Historical test fixture URL intentionally included fake `user:secret` credentials to assert external calendar URL validation rejects credentialed URLs. |
| `src/bun/plugin/inventory.test.ts` | `@secretlint/secretlint-rule-basicauth` | Historical plugin inventory tests intentionally included fake `user:secret` credentials to assert credentialed network patterns are reported. |
| `src/bun/plugin/manifest.test.ts` | `@secretlint/secretlint-rule-basicauth` | Historical manifest validation test intentionally included fake `user:secret` credentials to assert credentialed network patterns are rejected. |
| `src/bun/plugin/network-allowlist.test.ts` | `@secretlint/secretlint-rule-basicauth` | Historical network allowlist tests intentionally included fake `user:secret` credentials to assert credentialed URLs are rejected by matching and enforcement. |

## Conclusion

The Git-history Secretlint scan found only intentional fake credentials in historical tests that exercise rejection paths for credentialed URLs. No exposed real credentials were identified in this scan, and no credential rotation or history rewrite is required from these findings.

Together with `docs/working-tree-secret-scan-2026-06-02.md`, this completes the currently planned text secret scans before publication. Future scans should be rerun if new history is imported or if additional secret-scanning tools are added to the release checklist.
