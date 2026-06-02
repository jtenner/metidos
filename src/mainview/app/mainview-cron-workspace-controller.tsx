/**
 * @file src/mainview/app/mainview-cron-workspace-controller.tsx
 * @description Mainview cron workspace lifecycle controller and editor surface.
 */

import {
  type JSX,
  lazy,
  type SetStateAction,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type {
  ProjectProcedures,
  RpcCronJob,
  RpcModelOption,
  RpcPluginAccessGroupOption,
  RpcProject,
  RpcReasoningEffort,
  RpcReasoningEffortOption,
  RpcThread,
  RpcThreadDetail,
  RpcThreadPermissionDescriptor,
} from "../../bun/rpc-schema";
import { AppButton, TabButton } from "../controls/button";
import { CodexModelSelector } from "../controls/codex-model-selector";
import { ConfirmDialog } from "../controls/confirm-dialog";
import { materialSymbol } from "../controls/icons";
import { ModalDialogSurface } from "../controls/popover";
import {
  ThreadAccessControl,
  type ThreadAccessValue,
} from "../controls/thread-access-control";
import {
  resolveCronJobsInvalidationBehavior,
  resolveCronJobsLoadBehavior,
} from "../cronjob-load-state";
import { claimCronJobRun, releaseCronJobRun } from "../cronjob-run-state";
import { createAbortError, isAbortError } from "./async-request-state";
import { permissionsForDescribeCronThread } from "./cron-describe-thread-access";
import { FolderPathSelectorControl } from "./folder-path-selector-control";
import { subscribeToCronJobsChanged } from "./invalidation-events";
import type { MainviewPrimaryView } from "./mainview-shell-state";
import type { ProjectNodeState } from "./project-worktree-state";
import {
  setWorkspaceActiveSectionOpen,
  setWorkspacePanelOpen,
} from "./sidebar-panels-state";
import {
  accessPermissionsFromCronJob,
  useAccessPermissions,
} from "./use-access-permissions";
import { useAddProjectForm } from "./use-add-project-form";
import {
  CRON_JOBS_POLL_INTERVAL_MS,
  type OpenThreadOptions,
} from "./thread-ui-state";
import { upsertThreadList } from "./thread-store";

const CronjobWorkspace = lazy(async () => {
  const module = await import("./cronjob-workspace");
  return { default: module.CronjobWorkspace };
});

type CronCreatorMode = "describe" | "edit";
type CronControllerVariant = "desktop" | "mobile";

type MainviewCronWorkspaceControllerProps = {
  activeCodexModel: string;
  activeReasoningEffort: RpcReasoningEffort;
  activeSelectedWorktreePath: string | null;
  availablePluginAccessGroups: RpcPluginAccessGroupOption[];
  availableThreadPermissionDescriptors: RpcThreadPermissionDescriptor[];
  codexModels: RpcModelOption[];
  defaultCodexModel: string;
  defaultCodexReasoningEffort: RpcReasoningEffort;
  executeRpcAction: <T>(
    label: string,
    action: () => Promise<T>,
  ) => Promise<T | null>;
  getProjectState: (projectId: number) => ProjectNodeState;
  handleRefreshModelCatalog: () => Promise<void>;
  homeDirectory: string;
  hydrateProjectRows: (items: RpcProject[]) => void;
  isAdmin: boolean;
  isDocumentVisible: boolean;
  isRefreshingModelCatalog: boolean;
  openThread: (threadId: number, options?: OpenThreadOptions) => Promise<void>;
  prepareOpenedThreadDetail: (detail: RpcThreadDetail) => RpcThreadDetail;
  procedures: ProjectProcedures;
  reasoningEfforts: RpcReasoningEffortOption[];
  replaceThreads: (items: RpcThread[]) => void;
  safeChildAccessDefaults: ThreadAccessValue;
  selectedProject: RpcProject | null;
  selectedProjectId: number | null;
  selectedWorktreePath: string | null;
  setPrimaryViewForNavigation: (
    value: SetStateAction<MainviewPrimaryView>,
  ) => void;
  setProjectState: (
    projectId: number,
    update: Partial<ProjectNodeState>,
  ) => void;
  supportsTildePath: boolean;
  upsertProject: (project: RpcProject) => void;
  upsertThread: (thread: RpcThread) => void;
  variant: CronControllerVariant;
};

type CronEditorMutationState = {
  currentEditingCronJobId: number | null;
  isCreatingCronJob: boolean;
  isEditingCronDeleting: boolean;
  isEditingCronRunning: boolean;
};

export function describeCronEditorMutationState({
  currentEditingCronJobId,
  isCreatingCronJob,
  isEditingCronDeleting,
  isEditingCronRunning,
}: CronEditorMutationState): {
  deleteDisabled: boolean;
  deleteLabel: string;
  runNowDisabled: boolean;
  runNowLabel: string;
  submitLabel: string;
} {
  return {
    deleteDisabled:
      isCreatingCronJob || isEditingCronRunning || isEditingCronDeleting,
    deleteLabel: isEditingCronDeleting ? "Deleting…" : "Delete",
    runNowDisabled: isCreatingCronJob || isEditingCronRunning,
    runNowLabel: isEditingCronRunning ? "Running…" : "Run Now",
    submitLabel: isCreatingCronJob
      ? "Saving…"
      : currentEditingCronJobId === null
        ? "Create Cron"
        : "Save",
  };
}

type CronEditMutationDraft = {
  activeCodexModel: string;
  cronCreatorModel: string;
  cronCreatorReasoningEffort: RpcReasoningEffort;
  cronEditDescription: string;
  cronEditEnabled: boolean;
  cronEditPermissions: ThreadAccessValue["permissions"];
  cronEditProjectId: number | null;
  cronEditPrompt: string;
  cronEditSchedule: string;
  cronEditTitle: string;
  cronEditWorktreePath: string;
  defaultCodexModel: string;
  defaultCodexReasoningEffort: RpcReasoningEffort;
};

type CronEditMutationPayload = {
  description?: string;
  enabled: boolean;
  model?: string;
  permissions?: string[];
  projectId: number;
  prompt: string;
  reasoningEffort: RpcReasoningEffort;
  schedule: string;
  title?: string;
  worktreePath: string;
};

export function buildCronEditMutationPayload({
  activeCodexModel,
  cronCreatorModel,
  cronCreatorReasoningEffort,
  cronEditDescription,
  cronEditEnabled,
  cronEditPermissions,
  cronEditProjectId,
  cronEditPrompt,
  cronEditSchedule,
  cronEditTitle,
  cronEditWorktreePath,
  defaultCodexModel,
  defaultCodexReasoningEffort,
}: CronEditMutationDraft): CronEditMutationPayload {
  const schedule = cronEditSchedule.trim();
  const prompt = cronEditPrompt.trim();
  if (cronEditProjectId === null || !cronEditWorktreePath) {
    throw new Error("Select a folder for this cron job.");
  }
  if (!schedule || !prompt) {
    throw new Error(
      !schedule ? "Cron schedule is required." : "Cron prompt is required.",
    );
  }
  const model = cronCreatorModel.trim()
    ? cronCreatorModel.trim()
    : activeCodexModel || defaultCodexModel;
  const reasoningEffort =
    cronCreatorReasoningEffort || defaultCodexReasoningEffort;
  return {
    projectId: cronEditProjectId,
    worktreePath: cronEditWorktreePath,
    schedule,
    prompt,
    ...(model ? { model } : {}),
    reasoningEffort,
    ...(cronEditTitle.trim() ? { title: cronEditTitle.trim() } : {}),
    ...(cronEditDescription.trim()
      ? { description: cronEditDescription.trim() }
      : {}),
    ...(cronEditPermissions ? { permissions: cronEditPermissions } : {}),
    enabled: cronEditEnabled,
  };
}

export async function executeCronEditMutation({
  cronEditingCronJobId,
  draft,
  loadCronJobs,
  newCron,
  updateCron,
}: {
  cronEditingCronJobId: number | null;
  draft: CronEditMutationDraft;
  loadCronJobs: () => Promise<void>;
  newCron: (payload: CronEditMutationPayload) => Promise<unknown>;
  updateCron: (
    payload: CronEditMutationPayload & { cronJobId: number },
  ) => Promise<unknown>;
}): Promise<"created" | "updated"> {
  const payload = buildCronEditMutationPayload(draft);
  if (cronEditingCronJobId === null) {
    await newCron(payload);
    await loadCronJobs();
    return "created";
  }
  await updateCron({ cronJobId: cronEditingCronJobId, ...payload });
  await loadCronJobs();
  return "updated";
}

export async function executeCronRunNowMutation({
  cronJobId,
  isCurrentRequest,
  loadCronJobs,
  markNotRunning,
  markRunning,
  openCronThreadInRecent,
  runCronNow,
  setCronJobsError,
}: {
  cronJobId: number;
  isCurrentRequest: () => boolean;
  loadCronJobs: () => Promise<void>;
  markNotRunning: () => void;
  markRunning: () => void;
  openCronThreadInRecent: (threadId: number) => Promise<void>;
  runCronNow: (payload: { cronJobId: number }) => Promise<{
    success: boolean;
    threadId: number;
  }>;
  setCronJobsError: (message: string) => void;
}): Promise<"started" | "stale"> {
  markRunning();
  setCronJobsError("");
  try {
    const result = await runCronNow({ cronJobId });
    if (!result.success)
      throw new Error(`Cron job ${cronJobId} did not start.`);
    if (!isCurrentRequest()) return "stale";
    await openCronThreadInRecent(result.threadId);
    if (!isCurrentRequest()) return "stale";
    await loadCronJobs();
    return "started";
  } catch (error) {
    if (isCurrentRequest()) {
      setCronJobsError(error instanceof Error ? error.message : String(error));
    }
    throw error;
  } finally {
    markNotRunning();
  }
}

export async function executeCronDeleteMutation({
  closeCronCreatorIfEditing,
  cronJob,
  isCurrentRequest,
  loadCronJobs,
  markDeleting,
  markNotDeleting,
  removeCronJob,
  setCronJobsError,
  updateCron,
}: {
  closeCronCreatorIfEditing: (cronJobId: number) => void;
  cronJob: Pick<RpcCronJob, "id">;
  isCurrentRequest: () => boolean;
  loadCronJobs: () => void | Promise<void>;
  markDeleting: () => void;
  markNotDeleting: () => void;
  removeCronJob: (cronJobId: number) => void;
  setCronJobsError: (message: string) => void;
  updateCron: (payload: {
    cronJobId: number;
    deleted: true;
  }) => Promise<unknown>;
}): Promise<"deleted" | "stale"> {
  markDeleting();
  setCronJobsError("");
  try {
    await updateCron({ cronJobId: cronJob.id, deleted: true });
    if (!isCurrentRequest()) return "stale";
    removeCronJob(cronJob.id);
    closeCronCreatorIfEditing(cronJob.id);
    void loadCronJobs();
    return "deleted";
  } catch (error) {
    if (isCurrentRequest()) {
      setCronJobsError(error instanceof Error ? error.message : String(error));
    }
    throw error;
  } finally {
    markNotDeleting();
  }
}

function CronWorkspaceLoadingFallback({
  label,
  variant,
}: {
  label: string;
  variant: CronControllerVariant;
}): JSX.Element {
  const spacingClass =
    variant === "mobile" ? "px-4 py-6" : "min-h-0 flex-1 px-6 py-6";
  return (
    <div className={`flex ${spacingClass}`} role="status" aria-live="polite">
      <div className="w-full border-t border-border-subtle pt-3 text-xs text-text-muted">
        {label}
      </div>
    </div>
  );
}

export function MainviewCronWorkspaceController({
  activeCodexModel,
  activeReasoningEffort,
  activeSelectedWorktreePath,
  availablePluginAccessGroups,
  availableThreadPermissionDescriptors,
  codexModels,
  defaultCodexModel,
  defaultCodexReasoningEffort,
  executeRpcAction,
  getProjectState,
  handleRefreshModelCatalog,
  homeDirectory,
  hydrateProjectRows,
  isAdmin,
  isDocumentVisible,
  isRefreshingModelCatalog,
  openThread,
  prepareOpenedThreadDetail,
  procedures,
  reasoningEfforts,
  replaceThreads,
  safeChildAccessDefaults,
  selectedProject,
  selectedProjectId,
  selectedWorktreePath,
  setPrimaryViewForNavigation,
  setProjectState,
  supportsTildePath,
  upsertProject,
  upsertThread,
  variant,
}: MainviewCronWorkspaceControllerProps): JSX.Element {
  const [cronJobs, setCronJobs] = useState<RpcCronJob[]>([]);
  const [cronJobsError, setCronJobsError] = useState("");
  const [isLoadingCronJobs, setIsLoadingCronJobs] = useState(false);
  const [isCreatingCronJob, setIsCreatingCronJob] = useState(false);
  const [runningCronJobs, setRunningCronJobs] = useState(new Set<number>());
  const [deletingCronJobs, setDeletingCronJobs] = useState(new Set<number>());
  const [pendingCronDelete, setPendingCronDelete] = useState<RpcCronJob | null>(
    null,
  );
  const [cronCreatorMode, setCronCreatorMode] =
    useState<CronCreatorMode>("describe");
  const [cronCreatorOpen, setCronCreatorOpen] = useState(false);
  const [cronCreatorError, setCronCreatorError] = useState("");
  const [cronCreatorModel, setCronCreatorModel] = useState("");
  const [cronCreatorReasoningEffort, setCronCreatorReasoningEffort] =
    useState<RpcReasoningEffort>(defaultCodexReasoningEffort);
  const [cronDescribePrompt, setCronDescribePrompt] = useState("");
  const [cronEditTitle, setCronEditTitle] = useState("");
  const [cronEditDescription, setCronEditDescription] = useState("");
  const [cronEditSchedule, setCronEditSchedule] = useState("");
  const [cronEditPrompt, setCronEditPrompt] = useState("");
  const [cronEditEnabled, setCronEditEnabled] = useState(true);
  const [cronEditingCronJobId, setCronEditingCronJobId] = useState<
    number | null
  >(null);
  const [cronEditProjectId, setCronEditProjectId] = useState<number | null>(
    null,
  );
  const [cronEditWorktreePath, setCronEditWorktreePath] = useState("");
  const isMountedRef = useRef(true);
  const cronJobsRequestIdRef = useRef(0);
  const cronRunRequestIdsRef = useRef(new Map<number, number>());
  const cronDeleteRequestIdsRef = useRef(new Map<number, number>());
  const cronDescribeRequestIdRef = useRef(0);
  const runningCronJobIdsRef = useRef(new Set<number>());
  const loadCronJobsRef = useRef<
    ((options?: { background?: boolean }) => Promise<void>) | null
  >(null);
  const cronJobsAbortControllerRef = useRef<AbortController | null>(null);
  const cronJobsInitializedRef = useRef(false);
  const cronJobsInvalidatedWhileLoadingRef = useRef(false);
  const cronCreatorCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const ignoreMobileProjectListOpen = useCallback(
    (_value: SetStateAction<boolean>) => undefined,
    [],
  );
  const { access: cronEditorAccessValue, setAccess: setCronEditorAccessValue } =
    useAccessPermissions({ initialAccess: safeChildAccessDefaults });
  const { permissions: cronEditPermissions } = cronEditorAccessValue;

  const {
    addProjectError: cronFolderError,
    addProjectInputIsPreviewing: cronFolderInputIsPreviewing,
    addProjectOpen: cronFolderSelectorOpen,
    addProjectPath: cronFolderPath,
    cancelCreateFolderPrompt: cancelCronFolderCreatePrompt,
    closeAddProjectForm: closeCronFolderSelector,
    confirmCreateFolderPrompt: confirmCronFolderCreatePrompt,
    createFolderPromptPath: cronFolderCreatePromptPath,
    directorySuggestions: cronFolderSuggestions,
    directorySuggestionsLoading: cronFolderSuggestionsLoading,
    displayedAddProjectPath: displayedCronFolderPath,
    handleAddProjectPathChange: handleCronFolderPathChange,
    handleDirectorySuggestionEnter: handleCronFolderSuggestionEnter,
    handleDirectorySuggestionLeave: handleCronFolderSuggestionLeave,
    hoveredDirectorySuggestion: hoveredCronFolderSuggestion,
    isAddingProject: isSelectingCronFolder,
    resetAddProjectPath: resetCronFolderPath,
    selectDirectorySuggestion: selectCronFolderSuggestion,
    submitAddProject: submitCronFolderSelection,
    toggleAddProjectForm: toggleCronFolderSelector,
  } = useAddProjectForm({
    getProjectState,
    homeDirectory,
    hydrateProjectRows,
    procedures,
    selectProject: (project, worktreePath) => {
      setCronEditProjectId(project.id);
      setCronEditWorktreePath(worktreePath ?? project.path);
    },
    setMobileProjectListOpen: ignoreMobileProjectListOpen,
    setProjectState,
    supportsTildePath,
    upsertProject,
  });

  const abortCronJobsRequest = useCallback((reason: string) => {
    const controller = cronJobsAbortControllerRef.current;
    if (!controller) return;
    cronJobsInvalidatedWhileLoadingRef.current = false;
    cronJobsAbortControllerRef.current = null;
    controller.abort(createAbortError(null, reason));
  }, []);

  const loadCronJobs = useCallback(
    async (options?: { background?: boolean }) => {
      const loadBehavior = resolveCronJobsLoadBehavior({
        hasInitializedCronJobs: cronJobsInitializedRef.current,
        isBackgroundRefresh: options?.background === true,
        requestInFlight: cronJobsAbortControllerRef.current !== null,
      });
      if (loadBehavior.mode === "skip") return;
      const requestId = ++cronJobsRequestIdRef.current;
      const controller = new AbortController();
      cronJobsAbortControllerRef.current = controller;
      if (loadBehavior.showLoadingState) setIsLoadingCronJobs(true);
      if (loadBehavior.clearError) setCronJobsError("");
      try {
        const result = await procedures.listCrons(undefined, {
          priority: loadBehavior.mode,
          signal: controller.signal,
        });
        if (!isMountedRef.current || cronJobsRequestIdRef.current !== requestId)
          return;
        cronJobsInitializedRef.current = true;
        setCronJobs(result);
        setCronJobsError("");
      } catch (error) {
        if (
          isAbortError(error) ||
          !isMountedRef.current ||
          cronJobsRequestIdRef.current !== requestId
        )
          return;
        cronJobsInitializedRef.current = true;
        setCronJobsError(
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        if (cronJobsAbortControllerRef.current === controller)
          cronJobsAbortControllerRef.current = null;
        if (isMountedRef.current && cronJobsRequestIdRef.current === requestId)
          setIsLoadingCronJobs(false);
        if (
          isMountedRef.current &&
          cronJobsAbortControllerRef.current === null &&
          cronJobsInvalidatedWhileLoadingRef.current
        ) {
          cronJobsInvalidatedWhileLoadingRef.current = false;
          void loadCronJobsRef.current?.({ background: true });
        }
      }
    },
    [procedures],
  );
  loadCronJobsRef.current = loadCronJobs;

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      abortCronJobsRequest("Cron job request was canceled.");
    };
  }, [abortCronJobsRequest]);

  useEffect(() => {
    if (!isDocumentVisible) return;
    void loadCronJobs({ background: cronJobsInitializedRef.current });
    const timer = window.setInterval(
      () => void loadCronJobs({ background: true }),
      CRON_JOBS_POLL_INTERVAL_MS,
    );
    return () => window.clearInterval(timer);
  }, [isDocumentVisible, loadCronJobs]);

  useEffect(
    () =>
      subscribeToCronJobsChanged(() => {
        const invalidationBehavior = resolveCronJobsInvalidationBehavior({
          hasInitializedCronJobs: cronJobsInitializedRef.current,
          isDocumentVisible,
          requestInFlight: cronJobsAbortControllerRef.current !== null,
        });
        if (invalidationBehavior.mode === "ignore") return;
        if (invalidationBehavior.mode === "queue-background-refresh") {
          cronJobsInvalidatedWhileLoadingRef.current = true;
          return;
        }
        void loadCronJobs({
          background: invalidationBehavior.isBackgroundRefresh,
        });
      }),
    [isDocumentVisible, loadCronJobs],
  );

  const openCronThreadInRecent = useCallback(
    async (threadId: number) => {
      setWorkspacePanelOpen(true);
      setWorkspaceActiveSectionOpen(true);
      const [loadedDetail, loadedThreads] = await Promise.all([
        procedures.getThread(
          { threadId, includeHeavyContent: false },
          { priority: "foreground" },
        ),
        procedures.listThreads(),
      ]);
      if (!isMountedRef.current) return;
      const detail = prepareOpenedThreadDetail(loadedDetail);
      replaceThreads(upsertThreadList(loadedThreads, detail.thread));
      await new Promise<void>((resolve) =>
        window.requestAnimationFrame(() => resolve()),
      );
      if (!isMountedRef.current) return;
      setPrimaryViewForNavigation("chat");
      await openThread(threadId, { detailPromise: Promise.resolve(detail) });
    },
    [
      openThread,
      prepareOpenedThreadDetail,
      procedures,
      replaceThreads,
      setPrimaryViewForNavigation,
    ],
  );

  const handleRunCronNow = useCallback(
    (cronJobId: number) => {
      if (!claimCronJobRun(runningCronJobIdsRef.current, cronJobId)) return;
      const requestId = (cronRunRequestIdsRef.current.get(cronJobId) ?? 0) + 1;
      cronRunRequestIdsRef.current.set(cronJobId, requestId);
      void executeCronRunNowMutation({
        cronJobId,
        isCurrentRequest: () =>
          isMountedRef.current &&
          cronRunRequestIdsRef.current.get(cronJobId) === requestId,
        loadCronJobs,
        markNotRunning: () => {
          releaseCronJobRun(runningCronJobIdsRef.current, cronJobId);
          if (cronRunRequestIdsRef.current.get(cronJobId) === requestId)
            cronRunRequestIdsRef.current.delete(cronJobId);
          if (isMountedRef.current) {
            setRunningCronJobs((current) => {
              const next = new Set(current);
              next.delete(cronJobId);
              return next;
            });
          }
        },
        markRunning: () =>
          setRunningCronJobs((current) => new Set(current).add(cronJobId)),
        openCronThreadInRecent,
        runCronNow: procedures.runCronNow,
        setCronJobsError,
      }).catch(() => undefined);
    },
    [loadCronJobs, openCronThreadInRecent, procedures],
  );

  const handleDeleteCron = useCallback(
    (cronJob: RpcCronJob) => {
      if (!deletingCronJobs.has(cronJob.id)) setPendingCronDelete(cronJob);
    },
    [deletingCronJobs],
  );

  const closeCronCreator = useCallback(() => {
    setCronCreatorOpen(false);
    setCronCreatorError("");
    setCronEditingCronJobId(null);
    setCronEditProjectId(null);
    setCronEditWorktreePath("");
    closeCronFolderSelector();
  }, [closeCronFolderSelector]);

  const confirmDeleteCron = useCallback(() => {
    const cronJob = pendingCronDelete;
    if (!cronJob || deletingCronJobs.has(cronJob.id)) return;
    setPendingCronDelete(null);
    const requestId =
      (cronDeleteRequestIdsRef.current.get(cronJob.id) ?? 0) + 1;
    cronDeleteRequestIdsRef.current.set(cronJob.id, requestId);
    void executeCronDeleteMutation({
      closeCronCreatorIfEditing: (cronJobId) => {
        if (cronEditingCronJobId === cronJobId) closeCronCreator();
      },
      cronJob,
      isCurrentRequest: () =>
        isMountedRef.current &&
        cronDeleteRequestIdsRef.current.get(cronJob.id) === requestId,
      loadCronJobs,
      markDeleting: () =>
        setDeletingCronJobs((current) => new Set(current).add(cronJob.id)),
      markNotDeleting: () => {
        if (cronDeleteRequestIdsRef.current.get(cronJob.id) === requestId)
          cronDeleteRequestIdsRef.current.delete(cronJob.id);
        if (isMountedRef.current) {
          setDeletingCronJobs((current) => {
            const next = new Set(current);
            next.delete(cronJob.id);
            return next;
          });
        }
      },
      removeCronJob: (cronJobId) =>
        setCronJobs((current) =>
          current.filter((entry) => entry.id !== cronJobId),
        ),
      setCronJobsError,
      updateCron: procedures.updateCron,
    }).catch(() => undefined);
  }, [
    closeCronCreator,
    cronEditingCronJobId,
    deletingCronJobs,
    loadCronJobs,
    pendingCronDelete,
    procedures,
  ]);

  const resetCronCreatorFields = useCallback(() => {
    setCronEditingCronJobId(null);
    setCronEditProjectId(selectedProject?.id ?? null);
    setCronEditWorktreePath(activeSelectedWorktreePath ?? "");
    closeCronFolderSelector();
    setCronDescribePrompt("");
    setCronEditTitle("");
    setCronEditDescription("");
    setCronEditSchedule("");
    setCronEditPrompt("");
    setCronEditEnabled(true);
    setCronEditorAccessValue(safeChildAccessDefaults);
    setCronCreatorModel(activeCodexModel || defaultCodexModel || "");
    setCronCreatorReasoningEffort(
      activeReasoningEffort || defaultCodexReasoningEffort,
    );
    setCronCreatorError("");
  }, [
    activeCodexModel,
    activeReasoningEffort,
    activeSelectedWorktreePath,
    closeCronFolderSelector,
    defaultCodexModel,
    defaultCodexReasoningEffort,
    safeChildAccessDefaults,
    selectedProject?.id,
    setCronEditorAccessValue,
  ]);

  const openCronCreator = useCallback(
    (mode: CronCreatorMode = "describe") => {
      setCronCreatorMode(mode);
      resetCronCreatorFields();
      setCronCreatorOpen(true);
    },
    [resetCronCreatorFields],
  );

  const openCronEditor = useCallback(
    (cronJob: RpcCronJob) => {
      setCronCreatorMode("edit");
      setCronEditingCronJobId(cronJob.id);
      setCronEditProjectId(cronJob.projectId);
      setCronEditWorktreePath(cronJob.worktreePath);
      closeCronFolderSelector();
      setCronDescribePrompt("");
      setCronEditTitle(cronJob.title);
      setCronEditDescription(cronJob.description);
      setCronEditSchedule(cronJob.schedule);
      setCronEditPrompt(cronJob.prompt);
      setCronEditEnabled(cronJob.enabled === 1);
      setCronEditorAccessValue(accessPermissionsFromCronJob(cronJob));
      setCronCreatorModel(cronJob.model);
      setCronCreatorReasoningEffort(cronJob.reasoningEffort);
      setCronCreatorError("");
      setCronCreatorOpen(true);
    },
    [closeCronFolderSelector, setCronEditorAccessValue],
  );

  const refreshCronJobsForDescribeCron = useCallback(
    async (requestId: number) => {
      await loadCronJobs();
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 1_200));
        if (
          !isMountedRef.current ||
          cronDescribeRequestIdRef.current !== requestId
        )
          return;
        await loadCronJobs();
      }
    },
    [loadCronJobs],
  );

  const handleDescribeCronSubmit = useCallback(() => {
    const describePrompt = cronDescribePrompt.trim();
    if (cronEditProjectId === null || !cronEditWorktreePath) {
      setCronCreatorError("Select a folder before creating a cron job.");
      return;
    }
    if (!describePrompt) {
      setCronCreatorError("Describe the cron you want to create.");
      return;
    }
    const model = cronCreatorModel.trim()
      ? cronCreatorModel.trim()
      : activeCodexModel || defaultCodexModel || null;
    const reasoningEffort =
      cronCreatorReasoningEffort || defaultCodexReasoningEffort;
    const threadPermissions =
      permissionsForDescribeCronThread(cronEditPermissions);
    const requestId = cronDescribeRequestIdRef.current + 1;
    cronDescribeRequestIdRef.current = requestId;
    setIsCreatingCronJob(true);
    setCronCreatorError("");
    void (async () => {
      let createdDetail: RpcThreadDetail | null = null;
      try {
        createdDetail = await executeRpcAction(
          "create a thread outside the current workspace",
          () =>
            procedures.createThread({
              projectId: cronEditProjectId,
              worktreePath: cronEditWorktreePath,
              currentProjectId: selectedProjectId,
              currentWorktreePath: selectedWorktreePath,
              model,
              reasoningEffort:
                reasoningEffort || defaultCodexReasoningEffort || null,
              permissions: threadPermissions,
            }),
        );
        if (
          !createdDetail ||
          !isMountedRef.current ||
          cronDescribeRequestIdRef.current !== requestId
        )
          return;
        const threadId = createdDetail.thread.id;
        const threadMessage = [
          "Use the new_cron tool to create this cron job for the current workspace.",
          `Use permissions ${JSON.stringify(cronEditPermissions)}.`,
          "",
          describePrompt,
        ].join("\n");
        const sentDetail = await executeRpcAction(
          "create a cron job from a natural-language description",
          () =>
            procedures.sendThreadMessage({
              threadId,
              input: `${threadMessage}\n\nUse projectId ${cronEditProjectId} and worktree ${cronEditWorktreePath}.`,
            }),
        );
        if (
          !sentDetail ||
          !isMountedRef.current ||
          cronDescribeRequestIdRef.current !== requestId
        )
          return;
        upsertThread(sentDetail.thread);
        setPrimaryViewForNavigation("chat");
        await openThread(threadId, {
          detailPromise: Promise.resolve(sentDetail),
        });
        if (
          !isMountedRef.current ||
          cronDescribeRequestIdRef.current !== requestId
        )
          return;
        await refreshCronJobsForDescribeCron(requestId);
        if (
          !isMountedRef.current ||
          cronDescribeRequestIdRef.current !== requestId
        )
          return;
        closeCronCreator();
      } catch (error) {
        if (
          isMountedRef.current &&
          cronDescribeRequestIdRef.current === requestId
        ) {
          if (createdDetail) upsertThread(createdDetail.thread);
          setCronCreatorError(
            error instanceof Error ? error.message : String(error),
          );
        }
      } finally {
        if (
          isMountedRef.current &&
          cronDescribeRequestIdRef.current === requestId
        ) {
          setIsCreatingCronJob(false);
        }
      }
    })();
  }, [
    activeCodexModel,
    closeCronCreator,
    cronCreatorModel,
    cronCreatorReasoningEffort,
    cronDescribePrompt,
    cronEditPermissions,
    cronEditProjectId,
    cronEditWorktreePath,
    defaultCodexModel,
    defaultCodexReasoningEffort,
    executeRpcAction,
    openThread,
    procedures,
    refreshCronJobsForDescribeCron,
    selectedProjectId,
    selectedWorktreePath,
    setPrimaryViewForNavigation,
    upsertThread,
  ]);

  const handleEditCronSubmit = useCallback(() => {
    const updatingExistingCron =
      cronCreatorMode === "edit" && cronEditingCronJobId !== null;
    const draft = {
      activeCodexModel,
      cronCreatorModel,
      cronCreatorReasoningEffort,
      cronEditDescription,
      cronEditEnabled,
      cronEditPermissions,
      cronEditProjectId,
      cronEditPrompt,
      cronEditSchedule,
      cronEditTitle,
      cronEditWorktreePath,
      defaultCodexModel,
      defaultCodexReasoningEffort,
    };
    try {
      buildCronEditMutationPayload(draft);
    } catch (error) {
      setCronCreatorError(
        error instanceof Error ? error.message : String(error),
      );
      return;
    }
    setIsCreatingCronJob(true);
    setCronCreatorError("");
    void (async () => {
      try {
        await executeCronEditMutation({
          cronEditingCronJobId: updatingExistingCron
            ? cronEditingCronJobId
            : null,
          draft,
          loadCronJobs,
          newCron: (payload) => procedures.newCron(payload),
          updateCron: (payload) => procedures.updateCron(payload),
        });
        if (!updatingExistingCron) closeCronCreator();
      } catch (error) {
        setCronCreatorError(
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        setIsCreatingCronJob(false);
      }
    })();
  }, [
    activeCodexModel,
    closeCronCreator,
    cronCreatorMode,
    cronCreatorModel,
    cronCreatorReasoningEffort,
    cronEditDescription,
    cronEditEnabled,
    cronEditPermissions,
    cronEditProjectId,
    cronEditPrompt,
    cronEditSchedule,
    cronEditTitle,
    cronEditWorktreePath,
    cronEditingCronJobId,
    defaultCodexModel,
    defaultCodexReasoningEffort,
    loadCronJobs,
    procedures,
  ]);

  const modelValue = cronCreatorModel.trim()
    ? cronCreatorModel
    : activeCodexModel || defaultCodexModel || "";
  const currentEditingCronJobId =
    cronCreatorMode === "edit" ? cronEditingCronJobId : null;
  const currentEditingCronJob =
    currentEditingCronJobId === null
      ? null
      : (cronJobs.find((job) => job.id === currentEditingCronJobId) ?? null);
  const isEditingCronRunning =
    currentEditingCronJobId !== null &&
    runningCronJobs.has(currentEditingCronJobId);
  const isEditingCronDeleting =
    currentEditingCronJobId !== null &&
    deletingCronJobs.has(currentEditingCronJobId);
  const cronEditorMutationState = describeCronEditorMutationState({
    currentEditingCronJobId,
    isCreatingCronJob,
    isEditingCronDeleting,
    isEditingCronRunning,
  });
  const inputIdSuffix = variant === "mobile" ? "-mobile" : "";

  const openCronFolderSelector = useCallback(() => {
    resetCronFolderPath(cronEditWorktreePath || homeDirectory);
    if (!cronFolderSelectorOpen) toggleCronFolderSelector();
  }, [
    cronEditWorktreePath,
    cronFolderSelectorOpen,
    homeDirectory,
    resetCronFolderPath,
    toggleCronFolderSelector,
  ]);

  const containerClassName =
    variant === "mobile"
      ? "flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-6 pt-6"
      : "flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-6";

  return (
    <div className={containerClassName}>
      <div className="flex items-center justify-between">
        <div className="font-label text-xs uppercase tracking-widest text-accent">
          Cron jobs
        </div>
        <AppButton
          buttonStyle="secondary"
          type="button"
          onClick={() => openCronCreator("describe")}
        >
          New Cron
        </AppButton>
      </div>
      {cronCreatorOpen ? (
        <ModalDialogSurface
          backdropLabel="Close cron editor"
          className="relative w-full max-w-3xl border border-border-default bg-surface-1 text-text-primary shadow-overlay"
          initialFocusRef={cronCreatorCloseButtonRef}
          onRequestClose={closeCronCreator}
          open
        >
          <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
            <div className="text-sm font-semibold text-text-primary">
              {cronCreatorMode === "describe"
                ? "New cron job"
                : "Edit cron job"}
            </div>
            <AppButton
              unstyled
              type="button"
              aria-label="Close cron editor"
              className="flex h-7 w-7 shrink-0 items-center justify-center text-text-muted transition-colors hover:bg-surface-2 hover:text-text-primary"
              onClick={closeCronCreator}
              ref={cronCreatorCloseButtonRef}
            >
              {materialSymbol("close", "text-[15px]")}
            </AppButton>
          </div>
          <div className="max-h-[min(75vh,42rem)] space-y-4 overflow-y-auto p-4">
            <div
              className="flex h-8 border-b border-border-subtle"
              role="tablist"
              aria-label="Cron creation mode"
            >
              <TabButton
                selected={cronCreatorMode === "describe"}
                type="button"
                role="tab"
                aria-selected={cronCreatorMode === "describe"}
                className="px-3 text-xs"
                onClick={() => {
                  setCronCreatorError("");
                  setCronCreatorMode("describe");
                }}
              >
                Describe Cron
              </TabButton>
              <TabButton
                selected={cronCreatorMode === "edit"}
                type="button"
                role="tab"
                aria-selected={cronCreatorMode === "edit"}
                className="px-3 text-xs"
                onClick={() => {
                  setCronCreatorError("");
                  setCronCreatorMode("edit");
                }}
              >
                Edit Cron
              </TabButton>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="font-label text-[10px] uppercase tracking-widest text-text-faint">
                    Folder
                  </div>
                  <div className="break-all font-mono text-sm text-text-muted">
                    {cronEditWorktreePath || "No folder selected"}
                  </div>
                </div>
                <AppButton
                  buttonStyle="muted"
                  disabled={isCreatingCronJob}
                  onClick={openCronFolderSelector}
                >
                  Change Folder
                </AppButton>
              </div>
              {cronFolderSelectorOpen ? (
                <div className="border border-border-subtle bg-surface-1">
                  <FolderPathSelectorControl
                    addProjectError={cronFolderError}
                    addProjectInputIsPreviewing={cronFolderInputIsPreviewing}
                    addProjectPath={cronFolderPath}
                    directorySuggestions={cronFolderSuggestions}
                    directorySuggestionsLoading={cronFolderSuggestionsLoading}
                    createFolderPromptPath={cronFolderCreatePromptPath}
                    displayedAddProjectPath={displayedCronFolderPath}
                    homeDirectory={homeDirectory}
                    hoveredDirectorySuggestion={hoveredCronFolderSuggestion}
                    isAddingProject={isSelectingCronFolder}
                    onAddProjectPathChange={handleCronFolderPathChange}
                    onCancelCreateFolderPrompt={cancelCronFolderCreatePrompt}
                    onClose={closeCronFolderSelector}
                    onDirectorySuggestionEnter={handleCronFolderSuggestionEnter}
                    onDirectorySuggestionLeave={handleCronFolderSuggestionLeave}
                    onConfirmCreateFolderPrompt={confirmCronFolderCreatePrompt}
                    onSelectDirectorySuggestion={selectCronFolderSuggestion}
                    onSubmit={submitCronFolderSelection}
                    supportsTildePath={supportsTildePath}
                    cancelLabel="Close"
                    helpText="Cron runs will create threads in this folder. Missing folders can be created after confirmation."
                    inputName="cron-folder"
                    label="Cron Folder"
                    submitLabel="Use Folder"
                    submitLoadingLabel="Opening"
                  />
                </div>
              ) : null}
            </div>
            {cronCreatorMode === "describe" ? (
              <div className="space-y-3">
                <label
                  htmlFor={`cron-describe-input${inputIdSuffix}`}
                  className="font-label text-[11px] uppercase tracking-widest text-text-faint"
                >
                  Cron description
                </label>
                <textarea
                  id={`cron-describe-input${inputIdSuffix}`}
                  className="min-h-28 w-full resize-y border border-border-default bg-surface-2 px-3 py-2 text-sm text-text-secondary outline-none focus:border-accent focus:ring-2 focus:ring-accent/25"
                  placeholder="Describe cron schedule and work to perform."
                  rows={6}
                  value={cronDescribePrompt}
                  onChange={(event) =>
                    setCronDescribePrompt(event.target.value)
                  }
                />
              </div>
            ) : (
              <div className="space-y-3">
                <input
                  aria-label="Cron title"
                  className="w-full border border-border-default bg-surface-2 px-3 py-2 text-sm text-text-secondary outline-none focus:border-accent focus:ring-2 focus:ring-accent/25"
                  placeholder="Optional title"
                  value={cronEditTitle}
                  onChange={(event) => setCronEditTitle(event.target.value)}
                />
                <textarea
                  className="min-h-16 w-full resize-y border border-border-default bg-surface-2 px-3 py-2 text-sm text-text-secondary outline-none focus:border-accent focus:ring-2 focus:ring-accent/25"
                  placeholder="Optional description"
                  rows={3}
                  value={cronEditDescription}
                  onChange={(event) =>
                    setCronEditDescription(event.target.value)
                  }
                />
                <input
                  aria-label="Cron expression"
                  className="w-full border border-border-default bg-surface-2 px-3 py-2 text-sm text-text-secondary outline-none focus:border-accent focus:ring-2 focus:ring-accent/25"
                  placeholder="cron expression, e.g. */5 * * * *"
                  value={cronEditSchedule}
                  onChange={(event) => setCronEditSchedule(event.target.value)}
                />
                <textarea
                  className="min-h-20 w-full resize-y border border-border-default bg-surface-2 px-3 py-2 text-sm text-text-secondary outline-none focus:border-accent focus:ring-2 focus:ring-accent/25"
                  placeholder="What the cron run thread should do"
                  rows={4}
                  value={cronEditPrompt}
                  onChange={(event) => setCronEditPrompt(event.target.value)}
                />
                <label className="inline-flex items-center gap-3 text-xs leading-6 text-text-secondary">
                  <input
                    checked={cronEditEnabled}
                    className="h-6 w-6 shrink-0 accent-accent"
                    name="cron-enabled"
                    type="checkbox"
                    onChange={(event) =>
                      setCronEditEnabled(event.target.checked)
                    }
                  />
                  Enable immediately
                </label>
              </div>
            )}
            <div className="space-y-1">
              <div className="font-label text-[10px] uppercase tracking-widest text-text-faint">
                Model
              </div>
              <CodexModelSelector
                disabled={isCreatingCronJob}
                models={codexModels}
                onChange={(value) => {
                  setCronCreatorModel(value);
                  return undefined;
                }}
                onChangeReasoningEffort={(value) => {
                  setCronCreatorReasoningEffort(value);
                  return undefined;
                }}
                onRefresh={() => void handleRefreshModelCatalog()}
                reasoningDisabled={isCreatingCronJob}
                reasoningOptions={reasoningEfforts}
                reasoningValue={cronCreatorReasoningEffort}
                refreshing={isRefreshingModelCatalog}
                value={modelValue}
                variant={variant}
              />
            </div>
            <div className="space-y-1">
              <div className="font-label text-[10px] uppercase tracking-widest text-text-faint">
                Access controls
              </div>
              <ThreadAccessControl
                availablePluginAccessGroups={availablePluginAccessGroups}
                availableThreadPermissionDescriptors={
                  availableThreadPermissionDescriptors
                }
                disabled={isCreatingCronJob}
                onChange={setCronEditorAccessValue}
                title="Access controls for this cron job."
                showUnsafeMode={isAdmin}
                value={cronEditorAccessValue}
                variant={variant}
              />
            </div>
            {cronCreatorError ? (
              <div className="border border-danger-border bg-danger-surface px-3 py-2 text-xs text-danger-text">
                {cronCreatorError}
              </div>
            ) : null}
            <div className="flex justify-end gap-2">
              {currentEditingCronJobId !== null ? (
                <AppButton
                  buttonStyle="secondary"
                  disabled={cronEditorMutationState.runNowDisabled}
                  onClick={() => handleRunCronNow(currentEditingCronJobId)}
                >
                  {materialSymbol("arrow_forward", "text-[15px]")}
                  <span>{cronEditorMutationState.runNowLabel}</span>
                </AppButton>
              ) : null}
              {currentEditingCronJob ? (
                <AppButton
                  buttonStyle="error"
                  disabled={cronEditorMutationState.deleteDisabled}
                  onClick={() => handleDeleteCron(currentEditingCronJob)}
                >
                  {materialSymbol("delete", "text-[15px]")}
                  <span>{cronEditorMutationState.deleteLabel}</span>
                </AppButton>
              ) : null}
              <AppButton buttonStyle="muted" onClick={closeCronCreator}>
                Close
              </AppButton>
              <AppButton
                buttonStyle="secondary"
                disabled={isCreatingCronJob}
                onClick={() =>
                  cronCreatorMode === "describe"
                    ? handleDescribeCronSubmit()
                    : handleEditCronSubmit()
                }
              >
                {cronEditorMutationState.submitLabel}
              </AppButton>
            </div>
          </div>
        </ModalDialogSurface>
      ) : null}
      <Suspense
        fallback={
          <CronWorkspaceLoadingFallback
            label="Loading cron jobs..."
            variant={variant}
          />
        }
      >
        <CronjobWorkspace
          cronJobs={cronJobs}
          cronJobsError={cronJobsError}
          deletingCronJobs={deletingCronJobs}
          isLoadingCronJobs={isLoadingCronJobs}
          onDeleteCron={handleDeleteCron}
          onEditCron={openCronEditor}
          onRunCron={handleRunCronNow}
          runningCronJobs={runningCronJobs}
        />
      </Suspense>
      <ConfirmDialog
        confirmLabel="Delete"
        details={
          pendingCronDelete?.title.trim()
            ? pendingCronDelete.title.trim()
            : pendingCronDelete
              ? `#${pendingCronDelete.id}`
              : undefined
        }
        message="Delete cron job? This disables the cron and keeps its run history."
        onCancel={() => setPendingCronDelete(null)}
        onConfirm={confirmDeleteCron}
        open={pendingCronDelete !== null}
        title="Delete Cron Job"
      />
    </div>
  );
}
