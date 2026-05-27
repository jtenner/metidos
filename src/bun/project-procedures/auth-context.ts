import { AuthServiceError } from "../auth/service";
import type { RpcRequestContext } from "../rpc-schema";
import {
  getLocalOperatorState,
  requireCalendarOperatorUserId,
  requireLocalOperatorCapability,
  requireLocalOperatorUserId,
} from "./local-operator";

export function authUserId(context?: RpcRequestContext): number | null {
  return getLocalOperatorState(context).profile.userId;
}

export function requireAuthenticatedUserId(
  context?: RpcRequestContext,
): number {
  return requireLocalOperatorUserId(context);
}

export function requireCalendarUserId(context?: RpcRequestContext): number {
  return requireCalendarOperatorUserId(context);
}

export function isAdminContext(context?: RpcRequestContext): boolean {
  return getLocalOperatorState(context).canManageApp;
}

export function requireAdminContext(context?: RpcRequestContext): void {
  requireLocalOperatorCapability(context, "manage_app");
}

export function isRecentStepUpContext(
  context?: RpcRequestContext,
  nowMs = Date.now(),
): boolean {
  return getLocalOperatorState(context, nowMs).hasRecentStepUp;
}

export function requireRecentStepUpContext(
  context?: RpcRequestContext,
  nowMs = Date.now(),
): void {
  try {
    requireLocalOperatorCapability(context, "recent_step_up", nowMs);
  } catch (error) {
    if (error instanceof AuthServiceError) {
      throw error;
    }
    throw error;
  }
}
