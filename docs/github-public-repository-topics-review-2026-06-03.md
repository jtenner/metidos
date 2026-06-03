# GitHub Public Repository Topics Review — 2026-06-03

## Scope

This note covers the GitHub public repository setup checklist item to confirm whether repository topics support public discovery, match the README positioning, and avoid internal jargon before making the repository public.

## Evidence

### Initial review

- Command run from the repository root:
  - `gh repo view --json name,description,homepageUrl,repositoryTopics,visibility,isFork,defaultBranchRef`
- Observed repository: `jtenner/metidos`
- Observed visibility: `PRIVATE`
- Observed default branch: `master`
- Observed current topics:
  - `ai`
  - `ai-tools`
  - `automation`
  - `personal-assistant`
- README positioning reviewed:
  - Metidos is a local workspace for developers who use AI coding agents.
  - The README highlights Projects, Worktrees, Threads, Diffs, tasks, Plugins, Providers, and Cron Jobs.

## Assessment

The current topics are partly accurate, but incomplete for public discovery. `ai`, `ai-tools`, and `automation` fit the project. `personal-assistant` is less accurate because the README positions Metidos as local developer tooling for AI coding agent workflows, not as a general personal assistant.

The topic set should emphasize local developer tooling, coding agents, Git/worktree workflows, and the main implementation stack without using internal-only terms that people would not search for.

## Recommended public repository topics

Use this topic set when public repository settings are updated:

- `ai`
- `ai-tools`
- `ai-agents`
- `coding-agents`
- `developer-tools`
- `local-first`
- `automation`
- `git`
- `bun`
- `react`
- `typescript`

## Suggested removals

- Remove `personal-assistant` unless the project positioning changes to include general personal-assistant behavior.

## Settings update evidence

On 2026-06-03, an authenticated GitHub CLI settings update applied the recommended topic set while the repository was still private:

```sh
gh repo edit jtenner/metidos --add-topic ai,ai-tools,ai-agents,coding-agents,developer-tools,local-first,automation,git,bun,react,typescript --remove-topic personal-assistant
gh repo view jtenner/metidos --json nameWithOwner,repositoryTopics,visibility
```

The verification command returned `visibility: PRIVATE` and these topics:

- `ai`
- `ai-tools`
- `automation`
- `ai-agents`
- `bun`
- `coding-agents`
- `developer-tools`
- `git`
- `local-first`
- `react`
- `typescript`

## Acceptance decision

This checklist slice is complete: the repository topics were inspected, compared with the README, updated through the authenticated GitHub CLI workflow, and re-read from GitHub. The previous `personal-assistant` topic is no longer configured.
