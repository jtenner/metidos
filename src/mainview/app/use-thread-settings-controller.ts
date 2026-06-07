/**
 * @file src/mainview/app/use-thread-settings-controller.ts
 * @description Selected Thread model, reasoning effort, and Access Control update workflow controller.
 */

import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
} from "react";
import type {
  ProjectProcedures,
  RpcPluginAccessGroupOption,
  RpcReasoningEffort,
  RpcThread,
  RpcThreadPermissionDescriptor,
} from "../../bun/rpc-schema";
import type { ThreadAccessValue } from "../controls/thread-access-control";
import { shouldApplyThreadSettingUpdateToSelection } from "../thread-settings-update";
import {
  accessPermissionsEqual,
  accessPermissionsFromThread,
} from "./use-access-permissions";
import { sanitizeThreadAccessValue } from "./thread-access-sanitization";

export type ThreadSettingsControllerProps = {
  availablePluginAccessGroups: RpcPluginAccessGroupOption[];
  availableThreadPermissionDescriptors: RpcThreadPermissionDescriptor[];
  defaultCodexModel: string;
  defaultCodexReasoningEffort: RpcReasoningEffort;
  isUpdatingThreadAccess: boolean;
  isUpdatingThreadModel: boolean;
  isUpdatingThreadReasoningEffort: boolean;
  procedures: Pick<
    ProjectProcedures,
    "updateThreadAccess" | "updateThreadModel" | "updateThreadReasoningEffort"
  >;
  selectedThread: RpcThread | null;
  selectedThreadIdRef: MutableRefObject<number | null>;
  setIsUpdatingThreadAccess: Dispatch<SetStateAction<boolean>>;
  setIsUpdatingThreadModel: Dispatch<SetStateAction<boolean>>;
  setIsUpdatingThreadReasoningEffort: Dispatch<SetStateAction<boolean>>;
  setModelControlError: Dispatch<SetStateAction<string>>;
  setPendingThreadAccessValue: (access: ThreadAccessValue) => void;
  setPendingThreadModel: Dispatch<SetStateAction<string>>;
  setPendingThreadReasoningEffort: Dispatch<SetStateAction<RpcReasoningEffort>>;
  setReasoningEffortControlError: Dispatch<SetStateAction<string>>;
  setThreadAccessControlError: Dispatch<SetStateAction<string>>;
  upsertThread: (thread: RpcThread) => void;
};

export type ThreadSettingsController = {
  updateActiveCodexModel: (model: string) => Promise<boolean>;
  updateActiveReasoningEffort: (
    reasoningEffort: RpcReasoningEffort,
  ) => Promise<boolean>;
  updateActiveThreadAccess: (access: ThreadAccessValue) => Promise<void>;
};

export function shouldSyncThreadSettingsDraft({
  currentThreadId,
  isUpdating,
  nextThreadId,
}: {
  currentThreadId: number | null;
  isUpdating: boolean;
  nextThreadId: number | null;
}): boolean {
  return currentThreadId !== nextThreadId || !isUpdating;
}

export function useThreadSettingsController({
  availablePluginAccessGroups,
  availableThreadPermissionDescriptors,
  defaultCodexModel,
  defaultCodexReasoningEffort,
  isUpdatingThreadAccess,
  isUpdatingThreadModel,
  isUpdatingThreadReasoningEffort,
  procedures,
  selectedThread,
  selectedThreadIdRef,
  setIsUpdatingThreadAccess,
  setIsUpdatingThreadModel,
  setIsUpdatingThreadReasoningEffort,
  setModelControlError,
  setPendingThreadAccessValue,
  setPendingThreadModel,
  setPendingThreadReasoningEffort,
  setReasoningEffortControlError,
  setThreadAccessControlError,
  upsertThread,
}: ThreadSettingsControllerProps): ThreadSettingsController {
  const previousModelDraftThreadIdRef = useRef<number | null>(null);
  const previousReasoningDraftThreadIdRef = useRef<number | null>(null);
  const previousAccessDraftThreadIdRef = useRef<number | null>(null);

  useEffect(() => {
    const nextThreadId = selectedThread?.id ?? null;
    if (
      !shouldSyncThreadSettingsDraft({
        currentThreadId: previousModelDraftThreadIdRef.current,
        isUpdating: isUpdatingThreadModel,
        nextThreadId,
      })
    ) {
      return;
    }
    previousModelDraftThreadIdRef.current = nextThreadId;
    if (selectedThread?.model) {
      setPendingThreadModel(selectedThread.model);
      setModelControlError("");
      return;
    }
    if (defaultCodexModel) {
      setPendingThreadModel(defaultCodexModel);
    }
  }, [
    defaultCodexModel,
    isUpdatingThreadModel,
    selectedThread,
    setModelControlError,
    setPendingThreadModel,
  ]);

  useEffect(() => {
    const nextThreadId = selectedThread?.id ?? null;
    if (
      !shouldSyncThreadSettingsDraft({
        currentThreadId: previousReasoningDraftThreadIdRef.current,
        isUpdating: isUpdatingThreadReasoningEffort,
        nextThreadId,
      })
    ) {
      return;
    }
    previousReasoningDraftThreadIdRef.current = nextThreadId;
    if (selectedThread?.reasoningEffort) {
      setPendingThreadReasoningEffort(selectedThread.reasoningEffort);
      setReasoningEffortControlError("");
      return;
    }
    if (defaultCodexReasoningEffort) {
      setPendingThreadReasoningEffort(defaultCodexReasoningEffort);
    }
  }, [
    defaultCodexReasoningEffort,
    isUpdatingThreadReasoningEffort,
    selectedThread,
    setPendingThreadReasoningEffort,
    setReasoningEffortControlError,
  ]);

  useEffect(() => {
    const nextThreadId = selectedThread?.id ?? null;
    if (
      !shouldSyncThreadSettingsDraft({
        currentThreadId: previousAccessDraftThreadIdRef.current,
        isUpdating: isUpdatingThreadAccess,
        nextThreadId,
      })
    ) {
      return;
    }
    previousAccessDraftThreadIdRef.current = nextThreadId;
    if (!selectedThread) {
      return;
    }
    setPendingThreadAccessValue(accessPermissionsFromThread(selectedThread));
    setThreadAccessControlError("");
  }, [
    isUpdatingThreadAccess,
    selectedThread,
    setPendingThreadAccessValue,
    setThreadAccessControlError,
  ]);

  const updateActiveCodexModel = useCallback(
    async (model: string) => {
      setModelControlError("");
      if (!model) {
        return false;
      }

      if (!selectedThread) {
        setPendingThreadModel(model);
        return true;
      }

      if (selectedThread.model === model || isUpdatingThreadModel) {
        return selectedThread.model === model;
      }

      const requestedThreadId = selectedThread.id;
      setPendingThreadModel(model);
      setIsUpdatingThreadModel(true);
      try {
        const updatedThread = await procedures.updateThreadModel({
          threadId: requestedThreadId,
          model,
        });
        upsertThread(updatedThread);
        if (
          shouldApplyThreadSettingUpdateToSelection({
            requestedThreadId,
            selectedThreadId: selectedThreadIdRef.current,
          })
        ) {
          setPendingThreadModel(updatedThread.model);
        }
        return true;
      } catch (error) {
        if (
          shouldApplyThreadSettingUpdateToSelection({
            requestedThreadId,
            selectedThreadId: selectedThreadIdRef.current,
          })
        ) {
          setPendingThreadModel(selectedThread.model);
          setModelControlError(
            error instanceof Error ? error.message : String(error),
          );
        }
        return false;
      } finally {
        setIsUpdatingThreadModel(false);
      }
    },
    [
      isUpdatingThreadModel,
      procedures,
      selectedThread,
      selectedThreadIdRef,
      setIsUpdatingThreadModel,
      setModelControlError,
      setPendingThreadModel,
      upsertThread,
    ],
  );

  const updateActiveReasoningEffort = useCallback(
    async (reasoningEffort: RpcReasoningEffort) => {
      setReasoningEffortControlError("");
      if (!reasoningEffort) {
        return false;
      }

      if (!selectedThread) {
        setPendingThreadReasoningEffort(reasoningEffort);
        return true;
      }

      if (
        selectedThread.reasoningEffort === reasoningEffort ||
        isUpdatingThreadReasoningEffort
      ) {
        return selectedThread.reasoningEffort === reasoningEffort;
      }

      const requestedThreadId = selectedThread.id;
      setPendingThreadReasoningEffort(reasoningEffort);
      setIsUpdatingThreadReasoningEffort(true);
      try {
        const updatedThread = await procedures.updateThreadReasoningEffort({
          threadId: requestedThreadId,
          reasoningEffort,
        });
        upsertThread(updatedThread);
        if (
          shouldApplyThreadSettingUpdateToSelection({
            requestedThreadId,
            selectedThreadId: selectedThreadIdRef.current,
          })
        ) {
          setPendingThreadReasoningEffort(updatedThread.reasoningEffort);
        }
        return true;
      } catch (error) {
        if (
          shouldApplyThreadSettingUpdateToSelection({
            requestedThreadId,
            selectedThreadId: selectedThreadIdRef.current,
          })
        ) {
          setPendingThreadReasoningEffort(selectedThread.reasoningEffort);
          setReasoningEffortControlError(
            error instanceof Error ? error.message : String(error),
          );
        }
        return false;
      } finally {
        setIsUpdatingThreadReasoningEffort(false);
      }
    },
    [
      isUpdatingThreadReasoningEffort,
      procedures,
      selectedThread,
      selectedThreadIdRef,
      setIsUpdatingThreadReasoningEffort,
      setPendingThreadReasoningEffort,
      setReasoningEffortControlError,
      upsertThread,
    ],
  );

  const updateActiveThreadAccess = useCallback(
    async (access: ThreadAccessValue) => {
      setThreadAccessControlError("");
      const sanitizedAccess = sanitizeThreadAccessValue({
        access,
        availablePluginAccessGroups,
        availableThreadPermissionDescriptors,
      });

      if (!selectedThread) {
        setPendingThreadAccessValue(sanitizedAccess);
        return;
      }

      const selectedThreadAccess = sanitizeThreadAccessValue({
        access: accessPermissionsFromThread(selectedThread),
        availablePluginAccessGroups,
        availableThreadPermissionDescriptors,
      });

      if (
        accessPermissionsEqual(selectedThreadAccess, sanitizedAccess) ||
        isUpdatingThreadAccess
      ) {
        return;
      }

      const requestedThreadId = selectedThread.id;
      setIsUpdatingThreadAccess(true);
      try {
        const updatedThread = await procedures.updateThreadAccess({
          threadId: requestedThreadId,
          permissions: sanitizedAccess.permissions ?? [],
        });
        upsertThread(updatedThread);
        if (
          shouldApplyThreadSettingUpdateToSelection({
            requestedThreadId,
            selectedThreadId: selectedThreadIdRef.current,
          })
        ) {
          setPendingThreadAccessValue(
            accessPermissionsFromThread(updatedThread),
          );
        }
      } catch (error) {
        if (
          shouldApplyThreadSettingUpdateToSelection({
            requestedThreadId,
            selectedThreadId: selectedThreadIdRef.current,
          })
        ) {
          setThreadAccessControlError(
            error instanceof Error ? error.message : String(error),
          );
        }
      } finally {
        setIsUpdatingThreadAccess(false);
      }
    },
    [
      availablePluginAccessGroups,
      availableThreadPermissionDescriptors,
      isUpdatingThreadAccess,
      procedures,
      selectedThread,
      selectedThreadIdRef,
      setIsUpdatingThreadAccess,
      setPendingThreadAccessValue,
      setThreadAccessControlError,
      upsertThread,
    ],
  );

  return {
    updateActiveCodexModel,
    updateActiveReasoningEffort,
    updateActiveThreadAccess,
  };
}
