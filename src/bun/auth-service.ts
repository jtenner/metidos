/**
 * @file src/bun/auth-service.ts
 * @description Stable public entrypoint for the auth service modules.
 */

export {
  buildClearedSessionCookieHeader,
  buildClearedWebSocketTicketCookieHeader,
  buildSessionCookieHeader,
  buildWebSocketTicketCookieHeader,
  readSessionCookie,
  readWebSocketTicketCookie,
} from "./auth-service-cookies";
export {
  AuthServiceError,
  DEFAULT_SESSION_IDLE_TIMEOUT_MS,
  DEFAULT_STEP_UP_LIFETIME_MS,
} from "./auth-service-core";
export {
  createPendingUser,
  getAuthStatus,
  login,
  loginWithRecoveryCode,
  prepareTotpEnrollment,
  setupAuth,
  verifyPrimaryFactorAndRecoveryCode,
  verifyPrimaryFactorAndTotp,
} from "./auth-service-login";
export {
  issueWebSocketTicket,
  logout,
  requireFreshStepUp,
  resolveSession,
  stepUpSession,
  validateAndConsumeWebSocketTicket,
} from "./auth-service-session";
