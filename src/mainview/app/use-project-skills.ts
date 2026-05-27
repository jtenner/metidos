/**
 * @file src/mainview/app/use-project-skills.ts
 * @description Selected Worktree Skill refresh lifecycle for Mainview.
 */

import { useEffect, useState } from "react";
import type { ProjectProcedures } from "../../bun/rpc-schema";
import { createAbortError, isAbortError } from "./async-request-state";
import { PROJECT_SKILLS_POLL_INTERVAL_MS } from "./thread-ui-state";

type ProjectSkillsProcedures = Pick<ProjectProcedures, "listProjectSkills">;

type UseProjectSkillsParams = {
  isDocumentVisible: boolean;
  procedures: ProjectSkillsProcedures;
  projectId: number | null;
  worktreePath: string | null;
};

export function mergeProjectSkillNames(
  currentSkills: string[],
  nextSkills: string[],
): string[] {
  if (currentSkills.length !== nextSkills.length) {
    return nextSkills;
  }
  return currentSkills.every((skill, index) => skill === nextSkills[index])
    ? currentSkills
    : nextSkills;
}

function replaceSkillsIfChanged(
  setSkills: (update: (current: string[]) => string[]) => void,
  nextSkills: string[],
): void {
  setSkills((current) => mergeProjectSkillNames(current, nextSkills));
}

export function shouldRefreshProjectSkills({
  isDocumentVisible,
  projectId,
  worktreePath,
}: {
  isDocumentVisible: boolean;
  projectId: number | null;
  worktreePath: string | null;
}): boolean {
  return isDocumentVisible && projectId !== null && worktreePath !== null;
}

export function useProjectSkills({
  isDocumentVisible,
  procedures,
  projectId,
  worktreePath,
}: UseProjectSkillsParams): string[] {
  const [availableSkills, setAvailableSkills] = useState<string[]>([]);

  useEffect(() => {
    if (projectId === null || worktreePath === null) {
      replaceSkillsIfChanged(setAvailableSkills, []);
      return;
    }

    if (
      !shouldRefreshProjectSkills({
        isDocumentVisible,
        projectId,
        worktreePath,
      })
    ) {
      return;
    }

    let cancelled = false;
    let activeController: AbortController | null = null;
    const refreshAvailableSkills = () => {
      activeController?.abort(
        createAbortError(null, "Project skill refresh request was superseded."),
      );

      const controller = new AbortController();
      activeController = controller;
      void procedures
        .listProjectSkills(
          {
            projectId,
            worktreePath,
          },
          {
            priority: "background",
            signal: controller.signal,
          },
        )
        .then((result) => {
          if (!cancelled) {
            replaceSkillsIfChanged(
              setAvailableSkills,
              result.skills.map((skill) => skill.name),
            );
          }
        })
        .catch((error) => {
          if (isAbortError(error)) {
            return;
          }
          if (!cancelled) {
            replaceSkillsIfChanged(setAvailableSkills, []);
          }
        })
        .finally(() => {
          if (activeController === controller) {
            activeController = null;
          }
        });
    };

    refreshAvailableSkills();

    const timer = window.setInterval(
      refreshAvailableSkills,
      PROJECT_SKILLS_POLL_INTERVAL_MS,
    );
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      activeController?.abort(
        createAbortError(null, "Project skill refresh was canceled."),
      );
    };
  }, [isDocumentVisible, procedures, projectId, worktreePath]);

  return availableSkills;
}
