# Thread Runtime Tool Policy Inventory

Summary: Updated on 2026-05-18. The Metidos runtime no longer ships built-in WebView/browser tools. Browser automation and screenshots are provided by Plugin System browser plugins such as `chrome_browser`.

## Current native permissions

| Permission or context | Default | Active tools or behavior |
| --- | --- | --- |
| No extra permission | n/a | `read`, `ls`, `find`, `grep`, `edit`, `write` |
| `metidos:unsafe` | Off; approval-required | Adds `bash`, unsafe child-thread requests, and unsafe cron behavior through guarded Metidos tools. |
| `metidos:web-search` | On | Provider-native web search extension or Brave fallback `web_search` / `web_fetch`. |
| `metidos:webserver` | Off | `web_server_host`, `web_server_stop`, `web_server_list`. |
| `metidos:github` | Off | GitHub CLI-backed repository/issue/PR/check/diff helpers. |
| `metidos:git` | Off | Worktree-scoped Git CLI helpers. |
| `metidos:sqlite` | Off | Worktree-scoped SQLite query helper. |
| `metidos:lancedb` | Off | Project-scoped vector upsert/query/delete helpers. |
| `metidos:agents` | Off | `update_plan`, `delegate_task`. |
| `metidos:threads` | On | `update_thread`, `metidos_list_permissions`, and `new_thread` when thread access is selected. |
| `metidos:crons` | On | `list_crons`, `show_cron`, `new_cron`, `update_cron` when cron access is selected. |
| `metidos:calendar` | Off | Calendar list/show/create/modify event helpers; calendar creation stays in the UI and Plugin APIs, not native agent tools. |
| `metidos:notifications` | Off | `notify_user`. |
| Plugin permissions | Plugin-defined | Plugin tools exposed as `plugin_id_tool_name`; browser plugins own browser control and screenshots. |

## Removed browser surface

`metidos:webview` and the `webview_*` tool family have been removed from native Metidos permission discovery and runtime registration. Do not add new code that depends on `src/bun/pi/web-screenshot-tools.ts` or Bun WebView extraction helpers; those files were removed.
