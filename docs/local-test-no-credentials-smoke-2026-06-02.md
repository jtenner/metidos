# Local Test No-Credentials Smoke — 2026-06-02

## Scope

Verify that the repository test suite can run locally without private services or credentials.

This smoke run intentionally disabled Bun's automatic `.env` loading and unset common provider/token variables before running the root test script equivalent.

## Environment

- Date: 2026-06-02
- Workspace: `/home/jtenner/Projects/jt-ide`
- OS/kernel: Linux `eefe0b53020d` `6.12.90+deb13.1-amd64` x86_64
- Bun version: `1.3.14`

## Command

```sh
env \
  -u OPENAI_API_KEY \
  -u ANTHROPIC_API_KEY \
  -u GOOGLE_API_KEY \
  -u GEMINI_API_KEY \
  -u GITHUB_TOKEN \
  -u GH_TOKEN \
  -u DATABASE_URL \
  -u METIDOS_APP_DATA_DIR \
  bun --no-env-file test --timeout 10000 --parallel=8
```

## Result

Pass.

Summary reported by Bun:

- `2446 pass`
- `0 fail`
- `45885 expect() calls`
- `287 files`
- Runtime: `22.28s`

## Notes

- No private service credentials were supplied for this run.
- `--no-env-file` was used so the local `.env` file could not satisfy tests accidentally.
- The command did not require access to private packages or external provider services.
