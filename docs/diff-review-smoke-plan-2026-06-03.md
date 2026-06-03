# Diff Review Smoke Plan (2026-06-03)

This plan defines a disposable manual smoke for the public-readiness task: verify Diff review with small diffs, large diffs, binary files, deleted files, renamed files, and conflict-like scenarios.

## Scope

Verify that Metidos can open and present representative Git diff states from a clean disposable Project, that the Diff review UI remains understandable for normal and edge-case files, and that unsupported cases produce actionable, safe messages.

In scope:

- a small text diff with added, modified, and removed lines,
- a larger generated text diff that exercises scrolling/rendering without using private data,
- binary-file additions or modifications,
- deleted files,
- renamed files with and without content changes,
- conflict-like text markers in a safe fixture file,
- staged and unstaged changes if the UI distinguishes them,
- sanitized evidence collection for labels, summaries, limitations, and responsiveness.

Out of scope for this smoke:

- provider-backed agent review quality,
- exhaustive Git patch parsing correctness,
- real repositories, private file paths, secrets, customer data, or production App Data,
- very large repository performance beyond a generated moderate-size fixture,
- resolving merge conflicts or testing Git operations that mutate a real working tree.

## Preconditions

- Use a disposable Metidos App Data directory or clean local test profile.
- Use a disposable browser profile if normal browser state may expose private Projects or Worktrees.
- Keep Unsafe Mode off unless the Diff review entry point explicitly requires a documented local-only action; record the state either way.
- Prefer a provider-free or fake-provider setup. Do not enter real provider credentials for this smoke.
- Do not capture screenshots or logs containing usernames, hostnames, tokens, cookies, TOTP seeds, recovery codes, private repository names, private paths, provider account metadata, or customer data.
- If local Bun does not match `package.json` `packageManager`, record the mismatch and defer runtime evidence until the environment is corrected.

## Test fixture

Create a safe demo repository outside the real workspace or under a disposable temp directory. Suggested setup commands, adjusted for the disposable directory used by the tester:

```sh
mkdir -p "$TMPDIR/metidos-diff-review-smoke/demo-repo/src" "$TMPDIR/metidos-diff-review-smoke/demo-repo/docs" "$TMPDIR/metidos-diff-review-smoke/demo-repo/assets"
cd "$TMPDIR/metidos-diff-review-smoke/demo-repo"
git init
git checkout -b main
printf '# Diff review smoke fixture\n' > README.md
printf 'alpha\nbravo\ncharlie\n' > src/small.txt
printf 'old deleted content\n' > docs/delete-me.md
printf 'rename baseline\n' > docs/rename-me.md
for i in $(seq 1 220); do printf 'baseline line %03d\n' "$i"; done > src/large.txt
printf 'binary-baseline\0\1\2\3\n' > assets/demo.bin
git add README.md src docs assets
git commit -m 'Create diff review smoke baseline'

# Small text diff.
printf 'alpha\nbravo changed\ncharlie\ndelta added\n' > src/small.txt

# Large generated text diff.
for i in $(seq 1 260); do printf 'updated generated line %03d\n' "$i"; done > src/large.txt

# Deleted file.
rm docs/delete-me.md

# Renamed file with content change.
git mv docs/rename-me.md docs/renamed-file.md
printf 'rename baseline\nrename changed line\n' > docs/renamed-file.md

# Binary modification.
printf 'binary-updated\0\4\5\6\n' > assets/demo.bin

# Conflict-like marker text in a normal file.
cat > src/conflict-like.txt <<'EOF'
<<<<<<< ours
safe fixture ours text
=======
safe fixture theirs text
>>>>>>> theirs
EOF

# Staged-only file, if the app distinguishes staged and unstaged changes.
printf 'staged fixture\n' > src/staged-only.txt
git add src/staged-only.txt
```

Expected changed paths include:

- `src/small.txt`,
- `src/large.txt`,
- `assets/demo.bin`,
- `docs/delete-me.md`,
- `docs/renamed-file.md` with rename information from `docs/rename-me.md`,
- `src/conflict-like.txt`,
- `src/staged-only.txt` if staged changes are shown.

## Smoke steps

1. Start Metidos from the clean/disposable App Data setup using documented commands.
2. Complete Local Auth setup or login with fake/demo values if the setup is new.
3. Add the disposable repository as a Project and open its default Worktree.
4. Open Diff review or the equivalent changed-files view for the Worktree.
5. Confirm the changed-file list contains the expected small, large, binary, deleted, renamed, conflict-like, staged, and unstaged paths using sanitized labels.
6. Open the small text diff and confirm added, removed, and modified lines are understandable and not mislabeled.
7. Open the large generated diff and confirm scrolling/navigation remains usable; record any truncation, virtualization, loading indicator, or performance issue.
8. Open the binary-file change and confirm the UI either marks it as binary/non-renderable or provides a safe supported representation with a next step.
9. Open the deleted-file change and confirm the UI clearly shows the file was deleted and distinguishes removed content from current content.
10. Open the renamed-file change and confirm the UI shows rename context, content changes, or a clear limitation if rename detection is unavailable.
11. Open the conflict-like marker file and confirm the UI treats it as text diff content without implying an actual unresolved Git conflict unless Git reports one.
12. If staged and unstaged changes are surfaced separately, confirm staged-only and unstaged changes have distinct, accurate labels.
13. Reload the browser and confirm the Diff review view either restores the selected Project/Worktree/change context or returns to a clear Project/Worktree default without stale labels.
14. Inspect user-visible messages, startup logs, and diagnostics used for evidence; confirm they are actionable and do not expose secrets or unrelated private paths.
15. Stop the app and remove the disposable App Data, browser profile, and fixture repository unless intentionally retaining sanitized evidence fixtures.

## Evidence to record

Record a sanitized evidence note with:

- date and timezone,
- OS/container image,
- browser and version,
- Bun version and `package.json` `packageManager`,
- App Data setup method,
- fake/local/absent provider status,
- exact commands used to create the fixture, start the app, stop the app, and tear down fixtures,
- sanitized Project and Worktree path patterns without usernames or hostnames,
- pass/fail status for each smoke step,
- observed file labels and statuses for small, large, binary, deleted, renamed, conflict-like, staged, and unstaged changes,
- exact user-visible summaries for unsupported or limited diff cases,
- any responsiveness issues with the large generated diff,
- whether reload preserved or clearly reset the Diff review context,
- any documentation, UI, or Backend corrections needed.

## Acceptance criteria

The product-hardening TODO can be marked complete for Diff review only after sanitized evidence shows:

- a disposable Project can open a representative changed-files view from a clean setup,
- small text diffs render with understandable added, removed, and modified lines,
- large generated diffs remain usable or clearly communicate safe truncation/limitations,
- binary, deleted, renamed, and conflict-like cases are labeled accurately or provide actionable limitations,
- staged and unstaged states are accurate where the UI exposes them,
- reload does not leave stale Project, Worktree, or file-selection state,
- evidence contains no secrets, private machine identifiers, unrelated private paths, real customer/user data, or real provider credentials.
