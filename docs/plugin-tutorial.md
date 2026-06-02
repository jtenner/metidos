# Plugin tutorial: build, install, and approve a local tool

This tutorial walks from an empty folder to an installed and approved Metidos Plugin System v1 plugin. It creates a small TypeScript agent tool named `hello_world` that returns a bounded greeting.

Plugin System v1 is local and review-first. The Local Operator copies a plugin folder under the app-data plugin directory, reviews the manifest, hash, and capabilities in Settings → Plugins, and approves the plugin before Metidos runs it.

## Prerequisites

- A working Metidos checkout and local installation.
- Access to your Metidos app-data directory. In this guide, replace `APP_DATA` with the app-data path used by your install.
- Bun available from the repository root for manifest validation.

Do not put secrets, `node_modules/`, generated build output, `.data/`, `.data-bak-*`, or `.logs/` in the plugin source folder.

## 1. Create the plugin folder

Create a plugin directory whose folder name matches the manifest id:

```bash
mkdir -p APP_DATA/plugins/tutorial_hello_tool
cd APP_DATA/plugins/tutorial_hello_tool
```

Plugin ids must be unique, lowercase, and match `^[a-z][a-z0-9_]{1,63}$`. Do not use `metidos` as the plugin id or display name.

## 2. Add the manifest

Create `metidos-plugin.json`:

```json
{
  "id": "tutorial_hello_tool",
  "name": "Tutorial Hello Tool",
  "version": "1.0.0",
  "metidosApiVersion": "v1",
  "main": "./index.ts",
  "description": "Adds one tutorial hello-world tool for approved threads.",
  "permissions": ["log:write"],
  "access": [
    {
      "id": "tutorial_tools",
      "name": "Tutorial tools",
      "description": "Expose the tutorial hello_world tool to selected threads.",
      "tools": [
        {
          "name": "hello_world",
          "description": "Return a bounded tutorial greeting.",
          "timeoutMs": 5000
        }
      ]
    }
  ],
  "limits": {
    "maxTextResultBytes": 262144
  }
}
```

The manifest is the operator review contract. Keep permissions minimal and make sure every tool, access group, provider, cron, setting, env var, file allowlist, and network allowlist matches the code.

## 3. Add the entry point

Create `index.ts`:

```ts
import { definePlugin } from "@metidos/plugin-api";

export default definePlugin((metidos) => {
  metidos.addAgentTool({
    tool: "hello_world",
    name: "Hello world",
    description: "Return a bounded tutorial greeting.",
    timeoutMs: 5000,
    validateProps(input) {
      const record = input && typeof input === "object" ? input : {};
      const name =
        "name" in record && typeof record.name === "string"
          ? record.name.slice(0, 80)
          : "Metidos";
      return { name };
    },
    async action(context, props) {
      await metidos.log("info", `hello_world ran in ${context.contextKind}`);
      return { type: "text", text: `Hello, ${props.name}!` };
    },
  });
});
```

Keep `validateProps` defensive because tool input is untrusted. Bound strings before logging or returning them, and never log secrets.

## 4. Add operator guidance

Create `AGENTS.md`:

```md
# Tutorial Hello Tool plugin

Purpose: registers the `hello_world` agent tool for threads where the `tutorial_tools` access group is enabled.

Source files:
- `metidos-plugin.json` — manifest and review contract.
- `index.ts` — TypeScript plugin entry point.
- `AGENTS.md` — operator and agent guidance.

Runtime/generated files:
- `.data/**`, `.data-bak-*/**`, and `.logs/**` are created by Metidos when needed and are not plugin source.

Validation:
- From the Metidos repository root, validate the manifest with the command in `docs/metidos-plugin-authoring-guide.md`.
- Restart or refresh Metidos, then check Settings → Plugins for validation errors.

Data and reset behavior:
- This plugin does not use plugin storage or seed data.
- Reset Plugin Data should only remove generated runtime/log data.

Secrets and logs:
- No env vars or Plugin Settings are required.
- The tool logs only that it ran and the context kind; it must not log user prompts or secrets.

Approval notes:
- Review the deterministic hash in Settings → Plugins before approval.
- Any source, manifest, or AGENTS.md change requires Review Plugin Changes and re-approval.
```

Every plugin should include enough guidance for future operators and agents to validate, inspect, repair, and reset it safely.

## 5. Validate the manifest

From the Metidos repository root, run:

```bash
bun -e 'import Ajv from "ajv"; import { readFileSync } from "node:fs"; const [manifestPath = "metidos-plugin.json"] = process.argv.slice(1); const schema = JSON.parse(readFileSync("docs/metidos-plugin.schema.json", "utf8")); const manifest = JSON.parse(readFileSync(manifestPath, "utf8")); const validate = new Ajv({ allErrors: true, strict: false }).compile(schema); if (!validate(manifest)) { console.error(JSON.stringify(validate.errors, null, 2)); process.exit(1); } console.log("manifest schema ok");' APP_DATA/plugins/tutorial_hello_tool/metidos-plugin.json
```

Fix any schema errors before approval. For a repository-maintained plugin example, also add tests and run the plugin example test suite; for this local tutorial plugin, schema validation and Settings → Plugins validation are the important checks.

## 6. Refresh, review, and approve the plugin

1. Start or restart Metidos, or use the plugin refresh control if your installation is already running.
2. Open Settings → Plugins.
3. Find `Tutorial Hello Tool`.
4. Review:
   - plugin id, name, version, description, and deterministic folder hash;
   - requested permission: `log:write`;
   - access group: `tutorial_tools`;
   - declared tool: `hello_world`;
   - absence of file, network, storage, terminal, provider, cron, env, or secret access.
5. Approve the plugin only if the folder contents and declared capabilities match what you expect.

If the plugin shows validation errors, fix the source folder and refresh again. Do not approve a plugin you have not reviewed.

## 7. Enable the tool for a thread

Approval lets Metidos run the plugin, but thread-visible tools are still controlled by access groups.

1. Open or create a thread.
2. Enable the `Tutorial tools` access group for that thread.
3. Ask the agent to use the `hello_world` tool with a safe test input such as `{ "name": "Local Operator" }`.
4. Confirm the result is bounded and contains no private local data.

## 8. Change and re-approve safely

After approval, changes to source files such as `metidos-plugin.json`, `index.ts`, `AGENTS.md`, or `seed/**` invalidate the reviewed hash. In Settings → Plugins, use Review Plugin Changes and re-approve before relying on the changed plugin.

Runtime paths such as `.data/**`, `.data-bak-*/**`, and `.logs/**` are generated by Metidos and are excluded from the review hash. Inspect them read-only first, back them up before manual repair, and prefer Reset Plugin Data for unknown corruption.

## Next steps

- Copy from `docs/examples/plugins/hello_tool/` when you want a maintained minimal example.
- Use `docs/metidos-plugin-authoring-guide.md` for tools, prompt injections, crons, providers, file access, network access, settings, env vars, plugin storage, embeddings, and LanceDB patterns.
- Use `docs/metidos-plugin-agents-guide.md` as the template for production plugin `AGENTS.md` files.
- Use `docs/plugin-permissions.md` to understand each permission before requesting it.
