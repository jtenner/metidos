/**
 * @file src/bun/auth/service.ts
 * @description Stable public entrypoint for the auth service modules.
 */

export {
  AUTH_CSRF_COOKIE_NAME,
  AUTH_CSRF_TOKEN_MAX_AGE_SECONDS,
  buildAuthCsrfCookieHeader,
  buildClearedSessionCookieHeader,
  buildClearedWebSocketTicketCookieHeader,
  buildLogoutClearSiteDataHeader,
  buildSessionCookieHeader,
  buildWebSocketTicketCookieHeader,
  readAuthCsrfCookie,
  readSessionCookie,
  readUniqueCookieValue,
  readWebSocketTicketCookie,
} from "./service-cookies";
export {
  AuthServiceError,
  DEFAULT_SESSION_IDLE_TIMEOUT_MS,
  DEFAULT_STEP_UP_LIFETIME_MS,
} from "./service-core";
export {
  createPendingUser,
  findMatchingUnusedRecoveryCodeHash,
  getAuthStatus,
  login,
  loginWithRecoveryCode,
  prepareTotpEnrollment,
  setupAuth,
  verifyPrimaryFactorAndRecoveryCode,
  verifyPrimaryFactorAndTotp,
} from "./service-login";
export {
  getAuthSessionTouchCacheSize,
  issueWebSocketTicket,
  logout,
  resolveSession,
  stepUpSession,
  validateAndConsumeWebSocketTicket,
} from "./service-session";
