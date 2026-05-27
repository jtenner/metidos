/**
 * @file src/mainview/project-close.ts
 * @description Module for project close.
 */

export type RollbackSafeProjectCloseOptions = {
  closeProject: () => Promise<void>;
  commitLocalClose: () => void;
  onCloseError: (error: unknown) => void;
};

/**
 * Keep project collapse atomic from the UI's perspective: local close state is
 * committed only after the backend confirms the project transition.
 */
export async function runRollbackSafeProjectClose(
  options: RollbackSafeProjectCloseOptions,
): Promise<boolean> {
  try {
    await options.closeProject();
  } catch (error) {
    options.onCloseError(error);
    return false;
  }

  options.commitLocalClose();
  return true;
}
