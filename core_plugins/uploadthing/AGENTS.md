# AGENTS for UploadThing

## Purpose

This first-party core plugin exposes UploadThing REST API helpers to approved Metidos threads.

Registered tools:

- `list_files`: lists files through `/v6/listFiles`.
- `get_file`: requests file access through `/v6/requestFileAccess`, then downloads the file into the current project at the supplied `fileName`, supplied `path`, or `./{UploadThing file name}` by default.
- `upload_file`: reads a project file, requests `/v7/prepareUpload` presigned upload data, and sends the file bytes to the returned UploadThing ingest URL.
- `delete_file`: deletes files through `/v6/deleteFiles`.

UploadThing API key fallback order is the `api_key` Plugin Setting, then `UPLOADTHING_API_KEY`.

The plugin may read and write project files matching `files.allow` in `metidos-plugin.json` in thread tool contexts. This core plugin allows broad project reads and writes with `./**`; Metidos injects built-in file deny patterns for `.git` and `.ssh` and enforces them at the runtime file-operation boundary. The manifest also declares `storage:read` and `storage:write` because Plugin System v1 fs APIs require the matching storage permission before project `./` reads and writes can proceed, though this plugin does not intentionally read or write plugin-owned `.data`. It may fetch `https://api.uploadthing.com/**`, `https://eor9ytlmha.ufs.sh/**`, `https://ufs.sh/**`, `https://utfs.io/**`, plus the literal UploadThing ingest region hosts declared in the manifest for byte uploads, reads, and upload redirects.

## Source layout

- `metidos-plugin.json`: v1 manifest reviewed by the local operator.
- `index.ts`: plugin entry point and tool implementations.
- `AGENTS.md`: this guide.
- `.data/`: generated plugin data owned by Metidos. This plugin has `storage:read` and `storage:write` for the runtime fs guards but does not intentionally read or store downloaded file contents in `.data`; `get_file` writes downloads into the current project.
- `.logs/`: generated plugin logs when enabled; do not commit.
- `.data-bak-*`: generated reset backups; do not commit.

Root `node_modules/` is forbidden.

## Validation

1. Validate `core_plugins/uploadthing/metidos-plugin.json` against `docs/metidos-plugin.schema.json`.
2. Confirm `index.ts` imports only `@metidos/plugin-api`.
3. Confirm manifest tools match the registered tools in `index.ts`.
4. If changing core plugin behavior, run the repository plugin tests that cover manifests/startup where practical.

## `.data` contents

No durable `.data` files are expected. Downloads are written into the current project by `get_file` and can be regenerated from UploadThing while the source file remains available.

## Safe `.data` inspection

- Prefer read-only inspection.
- Do not copy or print secret-bearing files unless needed for repair.
- This plugin's UploadThing API key is configured through the `api_key` Plugin Setting or `UPLOADTHING_API_KEY`, not `.data`.

## Safe `.data` repair

If unexpected `.data` appears and causes failures, disable the plugin, back up the directory, and prefer Metidos Reset Plugin Data. Project files written by `get_file` are user-visible worktree files and should be repaired or removed through normal project-file workflows.

## Reset behavior

Metidos Reset Plugin Data moves `.data` to `.data-bak-{timestamp}`, recreates `.data`, copies `seed/**` if present, and restarts/reloads the plugin. This plugin has no seed files, so reset only clears unexpected runtime data. Plugin Settings such as `api_key` are not recreated by reset.

## Secrets and logs

Secrets:

- `api_key` Plugin Setting.
- Environment variable `UPLOADTHING_API_KEY`.

Do not paste API keys into chat, manifests, source files, logs, seed files, or tool results. This plugin does not intentionally write logs, but v1 does not guarantee automatic redaction of plugin-authored logs or returned tool text if logging is added later.

## Context notes

- `./` project file access works only in thread tool contexts and follows the runtime storage guards (`storage:read` for reads and `storage:write` for writes), `files.allow.read`/`files.allow.write`, plus injected deny rules such as `.git` and `.ssh`.
- Network access is limited to `https://api.uploadthing.com/**` and the literal UploadThing ingest region hosts declared in `metidos-plugin.json`.
- `get_file` writes to `./{fileName}`, the requested project `path`, or defaults to `./{UploadThing file name}`. Existing files at the destination may be overwritten by the project file API.
- `upload_file` asks UploadThing for presigned upload URLs using a project file name, size, MIME type, optional custom ID, ACL, content disposition, and metadata, then uploads the file bytes as multipart form data to the returned ingest URL.
- The tool currently caps file uploads at 700,000 bytes because project bytes cross the Plugin System v1 RPC boundary before fetch sends them.

## Embeddings and vector search

This plugin does not currently provide embedding models, call `metidos.embeddings.embed(...)`, or store LanceDB vectors. If future changes add semantic search or memory, update the manifest and this file together: embedding providers use `metidos:provides_embeddings`; embedding consumers use `metidos:can_embed`; vector storage uses `metidos:lancedb` plus `storage:write` and must stay scoped to plugin-owned `~/` data.
