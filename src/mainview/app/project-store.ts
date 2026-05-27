/**
 * @file src/mainview/app/project-store.ts
 * @description Focused Project store and ordering helpers.
 */

import type { RpcProject } from "../../bun/rpc-schema";

export type ProjectStore = {
  byId: Record<number, RpcProject>;
  orderedIds: number[];
};

export function emptyProjectStore(): ProjectStore {
  return {
    byId: {},
    orderedIds: [],
  };
}

/**
 * Reads all projects from a project store using its current ordering.
 */
export function projectStoreItems(store: ProjectStore): RpcProject[] {
  const items: RpcProject[] = [];

  for (const projectId of store.orderedIds) {
    const project = store.byId[projectId];
    if (project) {
      items.push(project);
    }
  }

  return items;
}

/**
 * Reads a project by id from a project store.
 */
export function projectStoreGet(
  store: ProjectStore,
  projectId: number,
): RpcProject | null {
  return store.byId[projectId] ?? null;
}

function compareProjects(left: RpcProject, right: RpcProject): number {
  return left.name.localeCompare(right.name, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function findProjectInsertionIndex(
  orderedIds: number[],
  byId: Record<number, RpcProject>,
  project: RpcProject,
): number {
  let low = 0;
  let high = orderedIds.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const midProjectId = orderedIds[mid];
    const midProject = midProjectId ? byId[midProjectId] : undefined;
    if (midProject && compareProjects(midProject, project) <= 0) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}

/**
 * Insert/replace a project preserving sorted order by project name.
 */
export function upsertProjectList(
  items: RpcProject[],
  project: RpcProject,
): RpcProject[] {
  const next = items.filter((entry) => entry.id !== project.id);
  next.push(project);
  return next.sort(compareProjects);
}

/**
 * Creates project store.
 */
export function createProjectStore(items: RpcProject[]): ProjectStore {
  const byId: Record<number, RpcProject> = {};

  for (const project of items) {
    byId[project.id] = project;
  }

  const orderedIds = Object.values(byId)
    .sort(compareProjects)
    .map((project) => project.id);

  return {
    byId,
    orderedIds,
  };
}

/**
 * Upserts project store.
 */
export function upsertProjectStore(
  store: ProjectStore,
  project: RpcProject,
): ProjectStore {
  const existingProject = store.byId[project.id];
  if (existingProject === project) {
    return store;
  }

  if (!existingProject) {
    const orderedIds = store.orderedIds.slice();
    const insertionIndex = findProjectInsertionIndex(
      orderedIds,
      store.byId,
      project,
    );
    orderedIds.splice(insertionIndex, 0, project.id);
    return {
      byId: {
        ...store.byId,
        [project.id]: project,
      },
      orderedIds,
    };
  }

  const existingIndex = store.orderedIds.indexOf(project.id);
  if (existingIndex === -1) {
    return createProjectStore([...projectStoreItems(store), project]);
  }

  const previousProjectId =
    existingIndex > 0 ? (store.orderedIds[existingIndex - 1] ?? null) : null;
  const nextProjectId =
    existingIndex < store.orderedIds.length - 1
      ? (store.orderedIds[existingIndex + 1] ?? null)
      : null;
  const previousProject =
    previousProjectId === null ? null : (store.byId[previousProjectId] ?? null);
  const nextProject =
    nextProjectId === null ? null : (store.byId[nextProjectId] ?? null);
  const staysInPlace =
    (previousProject === null ||
      compareProjects(previousProject, project) <= 0) &&
    (nextProject === null || compareProjects(project, nextProject) <= 0);
  if (staysInPlace) {
    return {
      byId: {
        ...store.byId,
        [project.id]: project,
      },
      orderedIds: store.orderedIds,
    };
  }

  const orderedIds = store.orderedIds.slice();
  orderedIds.splice(existingIndex, 1);
  const byId = {
    ...store.byId,
    [project.id]: project,
  };
  const insertionIndex = findProjectInsertionIndex(orderedIds, byId, project);
  orderedIds.splice(insertionIndex, 0, project.id);
  return {
    byId,
    orderedIds,
  };
}

/**
 * Removes project from store.
 */
export function removeProjectFromStore(
  store: ProjectStore,
  projectId: number,
): ProjectStore {
  if (!store.byId[projectId]) {
    return store;
  }

  const byId = {
    ...store.byId,
  };
  delete byId[projectId];

  return {
    byId,
    orderedIds: store.orderedIds.filter((entryId) => entryId !== projectId),
  };
}
