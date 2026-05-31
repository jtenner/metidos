/**
 * @file src/bun/pi/metidos/targeting.ts
 * @description Shared project/worktree/thread targeting helpers for Pi-native Metidos tools.
 */

import type { RpcProject, RpcThread, RpcWorktree } from "../../rpc-schema";
import {
  enforceBoundThreadScope,
  enforceTargetScope,
} from "../../thread-tool-scope";
import {
  canonicalPath,
  normalizeLookupValue,
  normalizeThreadIdInput,
  type PiMetidosToolHost,
  type PiMetidosToolScope,
  samePath,
  shortName,
} from "./shared";

export async function resolveProjectByName(
  projectName: string,
  host: PiMetidosToolHost,
  scope: PiMetidosToolScope,
): Promise<{ project: RpcProject; worktrees: RpcWorktree[] }> {
  const normalizedName = normalizeLookupValue(projectName);
  const looksLikePath =
    /[\\/]/u.test(projectName) ||
    projectName.startsWith(".") ||
    projectName.startsWith("~");
  const projects = await host.listProjects();
  const exactNameMatches = projects.filter(
    (project) =>
      normalizeLookupValue(project.name) === normalizedName ||
      normalizeLookupValue(shortName(project.path)) === normalizedName,
  );
  const pathMatches = looksLikePath
    ? projects.filter((project) => samePath(project.path, projectName, scope))
    : [];
  const matches =
    pathMatches.length > 0
      ? pathMatches
      : exactNameMatches.length > 0
        ? exactNameMatches
        : [];

  if (matches.length === 0) {
    throw new Error(`Project not found: ${projectName}`);
  }
  if (matches.length > 1) {
    throw new Error(
      `Project name is ambiguous: ${projectName}. Matches: ${matches
        .map((project) => `${project.name} (${project.path})`)
        .join(", ")}.`,
    );
  }

  const project = matches[0];
  if (!project) {
    throw new Error(`Project not found: ${projectName}`);
  }
  const worktrees = await host.listProjectWorktrees({
    projectId: project.id,
  });
  return {
    project,
    worktrees,
  };
}

export function resolveWorkspaceForProject(
  project: RpcProject,
  worktrees: RpcWorktree[],
  scope: PiMetidosToolScope,
  workspaceName?: string | null,
): RpcWorktree {
  if (typeof workspaceName !== "string" || !workspaceName.trim()) {
    if (worktrees.length === 0) {
      throw new Error(`No worktrees found in project ${project.name}.`);
    }
    const primaryWorktree =
      worktrees.find((worktree) =>
        samePath(worktree.path, project.path, scope),
      ) ?? worktrees[0];
    if (!primaryWorktree) {
      throw new Error(`No worktrees found in project ${project.name}.`);
    }
    return primaryWorktree;
  }

  const trimmedWorkspaceName = workspaceName.trim();
  const normalizedWorkspaceName = normalizeLookupValue(trimmedWorkspaceName);
  const candidates = worktrees.filter((worktree) => {
    if (samePath(worktree.path, trimmedWorkspaceName, scope)) {
      return true;
    }

    if (
      normalizeLookupValue(worktree.branch ?? "") === normalizedWorkspaceName
    ) {
      return true;
    }

    if (
      normalizeLookupValue(shortName(worktree.path)) === normalizedWorkspaceName
    ) {
      return true;
    }

    if (
      samePath(worktree.path, project.path, scope) &&
      normalizedWorkspaceName === "primary"
    ) {
      return true;
    }

    return false;
  });

  if (candidates.length === 0) {
    throw new Error(
      `Workspace not found in project ${project.name}: ${workspaceName}`,
    );
  }
  if (candidates.length > 1) {
    throw new Error(
      `Workspace name is ambiguous in project ${project.name}: ${workspaceName}. Matches: ${candidates
        .map((worktree) => `${worktree.branch ?? "Primary"} (${worktree.path})`)
        .join(", ")}.`,
    );
  }

  const workspace = candidates[0];
  if (!workspace) {
    throw new Error(`Workspace not found in project ${project.name}.`);
  }
  return workspace;
}

export async function resolveFocusContextTarget(
  options: {
    project: string;
    threadId?: string | number | null | undefined;
    workspace?: string | null | undefined;
  },
  host: PiMetidosToolHost,
  scope: PiMetidosToolScope,
): Promise<{
  project: RpcProject;
  threadId: number | null;
  worktree: RpcWorktree;
}> {
  const projectResolution = await resolveProjectByName(
    options.project,
    host,
    scope,
  );
  const requestedThreadId = normalizeThreadIdInput(options.threadId);
  if (requestedThreadId !== null) {
    enforceBoundThreadScope(requestedThreadId, scope.threadIdContext);
  }

  let resolvedThread: RpcThread | null = null;
  if (requestedThreadId !== null) {
    const threads = await host.listThreads();
    resolvedThread =
      threads.find((thread) => thread.id === requestedThreadId) ?? null;
    if (!resolvedThread) {
      throw new Error(`Thread not found: ${requestedThreadId}`);
    }
    if (resolvedThread.projectId !== projectResolution.project.id) {
      throw new Error(
        `Thread ${requestedThreadId} does not belong to project ${projectResolution.project.name}.`,
      );
    }
  }

  const worktree =
    requestedThreadId !== null && !options.workspace
      ? (projectResolution.worktrees.find((candidate) =>
          samePath(candidate.path, resolvedThread?.worktreePath ?? "", scope),
        ) ??
        resolveWorkspaceForProject(
          projectResolution.project,
          projectResolution.worktrees,
          scope,
          resolvedThread?.worktreePath ?? null,
        ))
      : resolveWorkspaceForProject(
          projectResolution.project,
          projectResolution.worktrees,
          scope,
          options.workspace ?? null,
        );

  enforceTargetScope({
    projectIdContext: scope.projectIdContext,
    targetProjectId: projectResolution.project.id,
    targetWorktreePath: worktree.path,
    worktreePathContext: scope.worktreePathContext,
  });

  if (
    resolvedThread &&
    !samePath(worktree.path, resolvedThread.worktreePath, scope)
  ) {
    throw new Error(
      `Thread ${requestedThreadId} does not belong to workspace ${worktree.path}.`,
    );
  }

  return {
    project: projectResolution.project,
    threadId: resolvedThread?.id ?? null,
    worktree,
  };
}

async function resolveProjectId(
  params: {
    projectId?: number | null | undefined;
    projectPath?: string | null | undefined;
  },
  host: PiMetidosToolHost,
  scope: PiMetidosToolScope,
): Promise<number> {
  if (typeof params.projectId === "number") {
    return params.projectId;
  }

  if (params.projectPath?.trim()) {
    const projectPath = canonicalPath(params.projectPath, scope);
    const projects = await host.listProjects();
    const matched = projects.find((project) =>
      samePath(project.path, projectPath, scope),
    );
    if (matched) {
      return matched.id;
    }
    throw new Error(`Project not found: ${params.projectPath}`);
  }

  return scope.projectIdContext;
}

async function resolveProjectIdForWorktreePath(
  worktreePath: string,
  host: PiMetidosToolHost,
  scope: PiMetidosToolScope,
  preferredProjectId?: number | null,
): Promise<number> {
  if (typeof preferredProjectId === "number") {
    const worktrees = await host
      .listProjectWorktrees({
        projectId: preferredProjectId,
      })
      .catch(() => []);
    if (
      worktrees.some((worktree) => samePath(worktree.path, worktreePath, scope))
    ) {
      return preferredProjectId;
    }
  }

  if (scope.projectIdContext !== preferredProjectId) {
    const worktrees = await host
      .listProjectWorktrees({
        projectId: scope.projectIdContext,
      })
      .catch(() => []);
    if (
      worktrees.some((worktree) => samePath(worktree.path, worktreePath, scope))
    ) {
      return scope.projectIdContext;
    }
  }

  for (const project of await host.listProjects()) {
    if (
      project.id === preferredProjectId ||
      project.id === scope.projectIdContext
    ) {
      continue;
    }
    const worktrees = await host.listProjectWorktrees({
      projectId: project.id,
    });
    if (
      worktrees.some((worktree) => samePath(worktree.path, worktreePath, scope))
    ) {
      return project.id;
    }
  }

  throw new Error(`Worktree not found: ${worktreePath}`);
}

export async function resolveWorktreeTarget(
  params: {
    projectId?: number | null | undefined;
    projectPath?: string | null | undefined;
    worktreePath?: string | null | undefined;
  },
  host: PiMetidosToolHost,
  scope: PiMetidosToolScope,
): Promise<{
  projectId: number;
  projectPath: string | null;
  worktreePath: string;
}> {
  if (params.worktreePath?.trim()) {
    const worktreePath = canonicalPath(params.worktreePath, scope);
    const explicitProjectId = await resolveProjectId(
      {
        projectId: params.projectId ?? null,
        projectPath: params.projectPath ?? null,
      },
      host,
      scope,
    ).catch(() => null);
    const projectId = await resolveProjectIdForWorktreePath(
      worktreePath,
      host,
      scope,
      explicitProjectId,
    );
    const projectPath =
      (await host.listProjects()).find((project) => project.id === projectId)
        ?.path ?? null;
    enforceTargetScope({
      projectIdContext: scope.projectIdContext,
      targetProjectId: projectId,
      targetWorktreePath: worktreePath,
      worktreePathContext: scope.worktreePathContext,
    });
    return {
      projectId,
      projectPath,
      worktreePath,
    };
  }

  const worktreePath = canonicalPath(scope.worktreePathContext, scope);
  let projectId: number;
  try {
    projectId = await resolveProjectIdForWorktreePath(
      worktreePath,
      host,
      scope,
      scope.projectIdContext,
    );
  } catch (error) {
    throw new Error(
      `Current worktree context is not tracked: ${scope.worktreePathContext}. Reopen or re-track the project/worktree, or pass projectPath and worktreePath explicitly.`,
      { cause: error },
    );
  }
  const projectPath =
    (await host.listProjects()).find((project) => project.id === projectId)
      ?.path ?? null;
  return {
    projectId,
    projectPath,
    worktreePath,
  };
}
