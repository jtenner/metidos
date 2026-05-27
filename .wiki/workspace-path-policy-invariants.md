# Workspace Path Policy Invariants

This note closes task `tg-01ks1000000000000000000022` by mapping the current Workspace path policy before extracting a Backend-owned module seam.

## Current Backend policy surface

`src/bun/project-procedures.ts` owns the effective policy today:

- `WorkspacePathScope` combines `homeDirectory`, optional `restrictedRoot`, and `supportsTildePath`.
- `workspacePathScopeForContext()` gives internal callers and local operators with Manage App Capability the OS home directory with no restricted root, while restricted compatibility profiles receive an app-data-owned private Workspace home at `getAppDataDirectoryPath()/users/<normalized-username>`.
- `normalizeRequestedWorkspacePath()` expands `~` only when the scope supports it, then resolves the result to an absolute path.
- `isWorkspacePathAllowed()` permits unrestricted internal/manage-app paths; for restricted scopes it requires:
  - the requested path to resolve inside `restrictedRoot`;
  - the nearest existing ancestor to exist;
  - that existing ancestor's `realpathSync()` result to remain inside `restrictedRoot` so symlink ancestors cannot escape.
- `assertWorkspacePathAllowed()` throws the stable security message `Workspace access is limited to the configured local workspace root.`.
- `formatWorkspacePathForUser()` renders restricted-scope paths under the restricted root as `~` or `~/...`; unrestricted paths remain absolute.

Important current split: `workspacePathScopeForProject()` returns `adminWorkspacePathScopeForInternalCall()` today, so Project-owned Worktree checks use an unrestricted internal scope. Visibility is enforced before Project lookup through `projectByIdForPath()` / `projectIsVisibleToContext()`, while follow-on Worktree validation uses that unrestricted Project scope. This should be retained unless a separate security decision changes it.

## Callers that must share the future policy module

Backend callers already applying some part of the policy:

- Project open/restore: `openProjectWithGitOptions()` normalizes the submitted path, asserts workspace access before directory checks, optionally creates missing directories, validates git status, and persists the Project.
- Directory suggestions: `listDirectorySuggestionsProcedure()` passes `homeDirectory`, `restrictedRoot`, and `supportsTildePath` into `src/bun/project-procedures/directory-suggestions.ts`.
- Project visibility: `visibleProjects()`, `projectIsVisibleToContext()`, `visibleThreads*()`, and `cronJobById()` hide Projects/Threads/Crons whose Project path is not visible to the caller.
- Worktree reads: `listFreshProjectWorktreeListing()` filters hidden/fresh Worktree rows through `isWorkspacePathAllowed()` when a restricted Project scope exists. With the current unrestricted Project scope this is effectively a no-op, but it is the call site that must reuse the extracted policy if Project scopes become restricted.
- Worktree mutation and selection flows: `createWorktreeProcedure()`, `setWorktreePinnedProcedure()`, `openWorktreeWithGitOptions()`, `setActiveWorktreeProcedure()`, `focusContextProcedureWithSession()`, and `closeWorktreeProcedure()` all normalize inbound Worktree paths and/or assert tracked Project Worktree membership.
- Thread and Cron creation/update: `createThreadProcedure()`, `requestThreadStartProcedure()`, `newCronProcedure()`, and `updateCronProcedure()` normalize Worktree paths, call `projectByIdForPath()`, then validate with `assertProjectWorkspacePath()`.
- Worktree-backed reads: `getWorktreeSnapshotProcedure()`, `listProjectSkillsProcedure()`, `readWorktreeFileContentPageProcedure()`, `readWorktreeFileDiffProcedure()`, `listWorktreeGitHistoryProcedure()`, and `getWorktreeGitCommitDiffProcedure()` normalize the Worktree path and validate tracked membership before filesystem/git access.
- Terminal creation: `createTerminalProcedure()` requires Manage App Capability, normalizes the Worktree path, and asserts tracked Project Worktree membership.
- Plugin ingress route configuration: `src/bun/project-procedures/plugin-procedures.ts` currently trims `params.worktreePath`, checks the Project row, and accepts either the Project root or a metadata-tracked Worktree. It does not call `normalizeRequestedWorkspacePath()` or the Workspace scope helpers directly. The Mainview save path first opens the folder as a Project and then sends `result.project.path`, but direct RPC callers are governed only by this backend route check.

## Mainview behavior to preserve

Mainview has presentation and prompt behavior that mirrors, but does not authorize, the Backend policy:

- `getHomeDirectoryProcedure()` returns the caller's effective home and tilde support. `src/mainview/app/use-mainview-startup-controller.ts` stores those values in app state.
- `src/mainview/app/path-display-state.ts` formats displayed/input paths with `~` when a path is under `homeDirectory`, and ensures directory inputs carry a trailing separator.
- `src/mainview/app/use-add-project-form.ts` seeds the add-project input from `homeDirectory`, debounces and caches `listDirectorySuggestions`, previews hovered suggestions, and prompts to create a missing folder only when the Backend error starts with `Project path does not exist:`.
- `src/mainview/app/folder-path-selector-control.tsx` renders folder suggestions, placeholders, errors, and the missing-folder confirmation dialog.
- Plugin ingress route editing reuses `FolderPathSelectorControl`; `settings-panel.tsx` opens the selected folder as a Project before saving the ingress route, then stores the normalized `result.project.path`.

Do not move security decisions into these Mainview helpers. They are UX mirrors; the future policy module must remain Backend-owned.

## Stable error messages and security-sensitive strings

Keep these exact strings stable unless a dedicated UX/security task updates both callers and tests:

- `Workspace access is limited to the configured local workspace root.` — restricted Workspace denial and symlink-escape guard.
- `A valid authenticated session is required to access workspace paths.` — unresolved regular-user context.
- `The current local-operator name cannot be mapped to a private workspace home.` — invalid username segment for private Workspace home.
- `Project path does not exist: <displayPath>` — drives Mainview missing-folder prompts.
- `Project path must be a directory: <displayPath>` — non-directory project path rejection.
- `Project folder must be a git repository root or worktree: <displayPath>(...)` — git-root/worktree validation failure.
- `Project not currently tracked: <id>` — hidden/missing Project access denial.
- `Worktree not found for project <projectPath>: <worktreePath>` — untracked/stale Worktree rejection.
- `Ingress route project is not available to the current user.` and `Ingress route worktree is not tracked for this project.` — Plugin ingress route target validation; the first string is a legacy compatibility wording for local-operator visibility.

## Initial module status

Task `tg-01ks1000000000000000000023` introduced `src/bun/project-procedures/workspace-path-policy.ts` as the first Backend-owned seam. `src/bun/project-procedures.ts` now calls the module for scope resolution, requested-path normalization, user-facing path formatting, nearest-existing-path allowed checks, allowed-path assertions, and directory-suggestion options. Plugin ingress route callers are intentionally mapped but not routed through the seam yet; that belongs to the follow-up route-sharing task.

## Future module responsibilities

The `workspace-path-policy` seam should continue to own:

- scope resolution for internal calls, local operators with Manage App Capability, restricted compatibility profiles, and Project-owned operations;
- username-to-private-Workspace-home normalization and directory creation;
- tilde expansion support and display formatting semantics;
- absolute path normalization;
- allowed-path checks, including restricted-root containment and nearest-existing-ancestor realpath validation;
- directory creation ordering so `createIfMissing` cannot create an escaping symlink path before denial;
- directory suggestion query parsing inputs and root filtering, or at least the shared policy object consumed by suggestions;
- stable error construction for Project, Worktree, directory suggestion, and ingress-route flows;
- a single test seam that callers can reuse without duplicating filesystem fixtures.

Non-goal for the initial extraction slice: changing the current `workspacePathScopeForProject()` behavior. If Project Worktree checks should become user-restricted, that should be a separate security decision with migration and UX notes.

## Tests to move or add at the seam

Existing coverage:

- `src/bun/project-procedures.workspace-scope.test.ts` covers fail-closed unresolved regular-user contexts, symlink-ancestor escape rejection during Project creation, and visibility of Projects/Threads/Crons under the regular user's Workspace home.
- `src/bun/project-procedures/workspace-path-policy.test.ts` covers the extracted policy seam for restricted scope construction, unresolved identity failure, unsafe username rejection, tilde normalization/formatting, unrestricted manage-app/internal scopes, nearest-existing-ancestor acceptance, outside-root rejection, symlink escape rejection, and directory-suggestion option projection.

Recommended policy-seam tests before/with the next routing slice:

- `normalizeRequestedWorkspacePath()` equivalents: `~`, `~/child`, absolute paths, platform tilde support disabled, and empty/relative inputs.
- `formatWorkspacePathForUser()` equivalents: restricted root itself (`~`), descendants (`~/child`), outside paths, and unrestricted scopes.
- `isWorkspacePathAllowed()` equivalents: inside restricted root, outside restricted root, missing leaf with inside nearest existing ancestor, symlink ancestor escaping outside, and unreadable/realpath failure.
- `ensureProjectDirectory()` ordering: deny restricted paths before or immediately after attempted creation without allowing symlink escapes; keep `Project path does not exist:` and `Project path must be a directory:` messages.
- Directory suggestions: tilde query parsing (`~`, `~/`, descendants), trailing separator handling, hidden-entry exclusion, root-directory filtering for search directory and returned child directories, and safe symlink directory inclusion.
- Worktree assertion: Project root fallback, hidden/stale Worktree lookup with `includeHidden`, and stable `Worktree not found for project ...` formatting.
- Plugin ingress route path validation: direct RPC calls should either explicitly preserve current trim + tracked-only behavior or be migrated to the shared normalization policy with tests for `~` input, untracked Worktree rejection, and route Project visibility.
