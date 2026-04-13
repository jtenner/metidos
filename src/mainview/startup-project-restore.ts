/**
 * @file src/mainview/startup-project-restore.ts
 * @description Module for startup project restore.
 */

import type {
  RpcOpenProjectsBatchResultItem,
  RpcProject,
} from "../bun/rpc-schema";
import { upsertProjectList } from "./app/state";

export type StartupProjectRestoreReconciliation = {
  failedProjectPaths: Set<string>;
  projects: RpcProject[];
  selectedProjectId: number | null;
  selectedWorktreePath: string | null;
};

/**
 * Treat every project as closed until the restore RPC confirms it reopened.
 */
export function closeProjectsForStartupRestore(
  projects: RpcProject[],
): RpcProject[] {
  return projects.map((project) =>
    project.isOpen === 0
      ? project
      : {
          ...project,
          isOpen: 0 as const,
        },
  );
}

/**
 * Collect the project ids whose tree/worktree state should be restored during
 * startup before the batch reopen RPC runs.
 */
export function collectStartupRestoreProjectIds(options: {
  initialProjectId: number | null;
  initialThreadProjectId: number | null;
  initiallyOpenProjectTreePaths: ReadonlySet<string>;
  loadedProjects: RpcProject[];
  openWorktrees: Array<{
    projectId: number;
  }>;
  selectedProjectId: number | null;
}): Set<number> {
  const restoredOpenProjectIds = new Set<number>();

  for (const project of options.loadedProjects) {
    if (options.initiallyOpenProjectTreePaths.has(project.path)) {
      restoredOpenProjectIds.add(project.id);
    }
  }

  for (const entry of options.openWorktrees) {
    restoredOpenProjectIds.add(entry.projectId);
  }

  if (options.selectedProjectId !== null) {
    restoredOpenProjectIds.add(options.selectedProjectId);
  }

  if (options.initialThreadProjectId !== null) {
    restoredOpenProjectIds.add(options.initialThreadProjectId);
  }

  if (options.initialProjectId !== null) {
    restoredOpenProjectIds.add(options.initialProjectId);
  } else if (options.loadedProjects[0]) {
    restoredOpenProjectIds.add(options.loadedProjects[0].id);
  }

  return restoredOpenProjectIds;
}

/**
 * Merge restore results back into the startup project list and optionally
 * retarget selection when the previous selection failed to reopen.
 */
export function reconcileStartupProjectRestore(options: {
  allowSelectedProjectFallback: boolean;
  projects: RpcProject[];
  results: RpcOpenProjectsBatchResultItem[];
  selectedProjectId: number | null;
  selectedWorktreePath: string | null;
}): StartupProjectRestoreReconciliation {
  const projectsById = new Map(
    options.projects.map((project) => [project.id, project] as const),
  );
  const failedProjectIds = new Set<number>();
  const failedProjectPaths = new Set<string>();
  const successfulProjectIds = new Set<number>();
  let projects = options.projects;

  for (const result of options.results) {
    if (result.ok) {
      successfulProjectIds.add(result.project.id);
      projects = upsertProjectList(projects, result.project);
      continue;
    }

    const failedProject = projectsById.get(result.projectId);
    failedProjectIds.add(result.projectId);
    if (failedProject) {
      failedProjectPaths.add(failedProject.path);
    }
  }

  let selectedProjectId = options.selectedProjectId;
  let selectedWorktreePath = options.selectedWorktreePath;
  if (
    options.allowSelectedProjectFallback &&
    selectedProjectId !== null &&
    failedProjectIds.has(selectedProjectId)
  ) {
    const fallbackProject =
      projects.find((project) => successfulProjectIds.has(project.id)) ?? null;
    if (fallbackProject) {
      selectedProjectId = fallbackProject.id;
      selectedWorktreePath = fallbackProject.path;
    }
  }

  return {
    failedProjectPaths,
    projects,
    selectedProjectId,
    selectedWorktreePath,
  };
}
