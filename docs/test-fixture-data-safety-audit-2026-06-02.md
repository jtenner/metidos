# Test Fixture Data Safety Audit — 2026-06-02

Scope: tracked test files under `src/**` whose filenames match `*test*`.

This audit verifies that existing tests use fixtures, fake data, or synthetic redaction sentinels instead of real repositories, secrets, personal paths, or customer/user data before public release.

## Environment

- Date: 2026-06-02
- Workspace: `/home/jtenner/Projects/jt-ide`
- OS: Linux `6.12.90+deb13.1-amd64` on x86_64
- Bun: `1.3.14`

## Commands run

```sh
find src -name '*test*' -type f | wc -l
rg -n --glob '*test*' --glob '!node_modules' --glob '!**/.metidos/**' '/home/jtenner|Projects/jt-ide|/Users/|C:\\Users|ghp_|sk-live|sk-[A-Za-z0-9]{20,}|BEGIN (RSA|OPENSSH|PRIVATE) KEY|customer|client|personal|private repo|real repo' src || true
rg -n --glob '*test*' --glob '!node_modules' --glob '!**/.metidos/**' '/home/jtenner|Projects/jt-ide|OPENAI_API_KEY|ANTHROPIC_API_KEY|sk-[A-Za-z0-9]|ghp_[A-Za-z0-9]|BEGIN (RSA|OPENSSH|PRIVATE) KEY|password\\s*[:=]\\s*[\"'\''][^\"'\'']{8,}' src || true
```

The first command counted 288 test files.

## Findings

- No test files referenced the real workspace path `/home/jtenner/Projects/jt-ide`.
- No test files contained GitHub personal-access-token shaped values (`ghp_...`) or private-key blocks.
- API-key environment names such as `OPENAI_API_KEY`, `AZURE_OPENAI_API_KEY`, and `CUSTOM_OPENAI_API_KEY` appear in provider/settings/terminal tests, but the values are synthetic sentinels such as `openai-secret`, `test-openai-key`, `env-key`, or missing-key placeholders.
- `src/bun/plugin/sidecar-manager.test.ts` includes `sk-live`, `Authorization: Bearer callback-secret`, and `/home/alice/private/repo` only inside a redaction regression that asserts those strings are removed from retained stderr.
- Mainview display/path tests use clearly fake paths such as `/Users/example/...` and fake home directories to verify path abbreviation/rendering behavior.
- Git tool tests create disposable fixture repositories at runtime using temporary directories rather than relying on this repository or another real local checkout.
- Calendar tests use the domain term `personal calendar`; that is fixture state, not personal user data.

## Conclusion

The sampled pattern sweep did not find real repositories, real secrets, personal workspace paths, or private customer/user data in the tracked test suite. Existing suspicious-looking strings are synthetic fixture values or explicit redaction sentinels.

Future tests should continue to use temporary fixture repositories, fake paths such as `/Users/example`, and non-secret sentinel values when exercising redaction or credential-display behavior.
