import { AuthServiceError } from "../auth/service";
import type { RpcRequestContext } from "../rpc-schema";

export type LocalOperatorCapability =
  | "authenticated"
  | "manage_app"
  | "recent_step_up"
  | "unsafe_mode";

export type LocalOperatorProfile = {
  sessionId: string | null;
  userId: number | null;
  username: string | null;
};

export type LocalOperatorState = {
  profile: LocalOperatorProfile;
  hasAuthenticatedSession: boolean;
  hasRecentStepUp: boolean;
  canManageApp: boolean;
  canUseUnsafeMode: boolean;
};

function stepUpValidUntilMs(context?: RpcRequestContext): number | null {
  const value = context?.auth.stepUpValidUntil;
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function getLocalOperatorProfile(
  context?: RpcRequestContext,
): LocalOperatorProfile {
  const username = context?.auth.username?.trim();
  return {
    sessionId: context?.auth.sessionId ?? null,
    userId:
      typeof context?.auth.userId === "number" ? context.auth.userId : null,
    username: username ? username : null,
  };
}

export function getLocalOperatorState(
  context?: RpcRequestContext,
  nowMs = Date.now(),
): LocalOperatorState {
  const profile = getLocalOperatorProfile(context);
  const hasAuthenticatedSession = typeof profile.userId === "number";
  const validUntilMs = stepUpValidUntilMs(context);
  const hasRecentStepUp =
    typeof validUntilMs === "number" && validUntilMs > nowMs;
  const canManageApp = context?.auth.isAdmin === true;
  return {
    profile,
    hasAuthenticatedSession,
    hasRecentStepUp,
    canManageApp,
    canUseUnsafeMode: canManageApp,
  };
}

export function localOperatorHasCapability(
  context: RpcRequestContext | undefined,
  capability: LocalOperatorCapability,
  nowMs = Date.now(),
): boolean {
  const state = getLocalOperatorState(context, nowMs);
  switch (capability) {
    case "authenticated":
      return state.hasAuthenticatedSession;
    case "manage_app":
      return state.canManageApp;
    case "recent_step_up":
      return state.hasAuthenticatedSession && state.hasRecentStepUp;
    case "unsafe_mode":
      return state.canUseUnsafeMode;
  }
}

function capabilityFailure(
  capability: LocalOperatorCapability,
): AuthServiceError {
  switch (capability) {
    case "authenticated":
      return new AuthServiceError(
        "session_required",
        "A valid authenticated session is required.",
        401,
      );
    case "manage_app":
      return new AuthServiceError(
        "admin_required",
        "Local operator privileges are required for this action.",
        403,
      );
    case "recent_step_up":
      return new AuthServiceError(
        "step_up_required",
        "Recent step-up authentication is required for this sensitive action.",
        403,
      );
    case "unsafe_mode":
      return new AuthServiceError(
        "admin_required",
        "Local operator privileges are required to enable unsafe mode.",
        403,
      );
  }
}

export function requireLocalOperatorCapability(
  context: RpcRequestContext | undefined,
  capability: LocalOperatorCapability,
  nowMs = Date.now(),
): LocalOperatorState {
  const state = getLocalOperatorState(context, nowMs);
  if (localOperatorHasCapability(context, capability, nowMs)) {
    return state;
  }
  if (capability === "recent_step_up" && !state.hasAuthenticatedSession) {
    throw capabilityFailure("authenticated");
  }
  throw capabilityFailure(capability);
}

export function requireLocalOperatorUserId(
  context?: RpcRequestContext,
): number {
  return requireLocalOperatorCapability(context, "authenticated").profile
    .userId as number;
}

export function requireCalendarOperatorUserId(
  context?: RpcRequestContext,
): number {
  const userId = getLocalOperatorProfile(context).userId;
  if (typeof userId === "number") {
    return userId;
  }
  throw new AuthServiceError(
    "session_required",
    "A valid authenticated session is required for calendar access.",
    401,
  );
}
