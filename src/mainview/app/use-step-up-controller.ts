/**
 * @file src/mainview/app/use-step-up-controller.ts
 * @description Extracted step-up dialog state and retry controller for App.tsx.
 */

import {
  type Dispatch,
  type FormEvent,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { AuthPrimaryFactorType } from "../../bun/db";
import { isStepUpRequiredError } from "../rpc-errors";

type StepUpAuthInput = {
  primaryFactor: string;
  totpCode: string;
};

type UseStepUpControllerParams = {
  primaryFactorType: AuthPrimaryFactorType | null;
  stepUpAuth: (input: StepUpAuthInput) => Promise<unknown>;
};

type UseStepUpControllerResult = {
  closeStepUpDialog: (authorized: boolean) => void;
  executeWithStepUp: <T>(
    actionLabel: string,
    action: () => Promise<T>,
  ) => Promise<T | null>;
  isSubmittingStepUp: boolean;
  setStepUpPrimaryFactor: Dispatch<SetStateAction<string>>;
  setStepUpTotpCode: Dispatch<SetStateAction<string>>;
  stepUpActionLabel: string;
  stepUpDialogOpen: boolean;
  stepUpError: string;
  stepUpPrimaryFactor: string;
  stepUpTotpCode: string;
  submitStepUp: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  updateStepUpPrimaryFactor: (value: string) => void;
  updateStepUpTotpCode: (value: string) => void;
};

/**
 * Keep the step-up dialog lifecycle, retry path, and input normalization out of App.tsx.
 */
export function useStepUpController({
  primaryFactorType,
  stepUpAuth,
}: UseStepUpControllerParams): UseStepUpControllerResult {
  const [stepUpActionLabel, setStepUpActionLabel] = useState("");
  const [stepUpDialogOpen, setStepUpDialogOpen] = useState(false);
  const [stepUpError, setStepUpError] = useState("");
  const [stepUpPrimaryFactor, setStepUpPrimaryFactor] = useState("");
  const [stepUpTotpCode, setStepUpTotpCode] = useState("");
  const [isSubmittingStepUp, setIsSubmittingStepUp] = useState(false);
  const stepUpRequestResolveRef = useRef<
    ((authorized: boolean) => void) | null
  >(null);

  const closeStepUpDialog = useCallback((authorized: boolean) => {
    setStepUpDialogOpen(false);
    setIsSubmittingStepUp(false);
    setStepUpError("");
    setStepUpPrimaryFactor("");
    setStepUpTotpCode("");
    const resolveStepUp = stepUpRequestResolveRef.current;
    stepUpRequestResolveRef.current = null;
    resolveStepUp?.(authorized);
  }, []);

  const requestStepUp = useCallback((actionLabel: string): Promise<boolean> => {
    setStepUpActionLabel(actionLabel);
    setStepUpDialogOpen(true);
    setStepUpError("");
    setStepUpPrimaryFactor("");
    setStepUpTotpCode("");
    setIsSubmittingStepUp(false);

    return new Promise<boolean>((resolve) => {
      stepUpRequestResolveRef.current = resolve;
    });
  }, []);

  const executeWithStepUp = useCallback(
    async <T>(
      actionLabel: string,
      action: () => Promise<T>,
    ): Promise<T | null> => {
      try {
        return await action();
      } catch (error) {
        if (!isStepUpRequiredError(error)) {
          throw error;
        }

        const authorized = await requestStepUp(actionLabel);
        if (!authorized) {
          return null;
        }
        return action();
      }
    },
    [requestStepUp],
  );

  const submitStepUp = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setIsSubmittingStepUp(true);
      setStepUpError("");
      try {
        await stepUpAuth({
          primaryFactor: stepUpPrimaryFactor,
          totpCode: stepUpTotpCode,
        });
        closeStepUpDialog(true);
      } catch (error) {
        setStepUpError(error instanceof Error ? error.message : String(error));
        setIsSubmittingStepUp(false);
      }
    },
    [closeStepUpDialog, stepUpAuth, stepUpPrimaryFactor, stepUpTotpCode],
  );

  const updateStepUpPrimaryFactor = useCallback(
    (value: string): void => {
      setStepUpPrimaryFactor(
        primaryFactorType === "pin" ? value.replace(/\D+/g, "") : value,
      );
    },
    [primaryFactorType],
  );

  const updateStepUpTotpCode = useCallback((value: string): void => {
    setStepUpTotpCode(value.replace(/\D+/g, ""));
  }, []);

  useEffect(() => {
    return () => {
      stepUpRequestResolveRef.current?.(false);
      stepUpRequestResolveRef.current = null;
    };
  }, []);

  return {
    closeStepUpDialog,
    executeWithStepUp,
    isSubmittingStepUp,
    setStepUpPrimaryFactor,
    setStepUpTotpCode,
    stepUpActionLabel,
    stepUpDialogOpen,
    stepUpError,
    stepUpPrimaryFactor,
    stepUpTotpCode,
    submitStepUp,
    updateStepUpPrimaryFactor,
    updateStepUpTotpCode,
  };
}
