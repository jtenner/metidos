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
