/**
 * @file src/bun/auth-service-login.ts
 * @description Setup, login, recovery, and auth-status flows.
 */

import type { Database } from "bun:sqlite";

import {
  type AuthSetupMaterial,
  buildTotpUri,
  DEFAULT_SESSION_LIFETIME_DAYS,
  generateRecoveryCodes,
  generateTotpSecret,
  hashPrimaryFactor,
  hashRecoveryCode,
  verifyPrimaryFactor,
  verifyRecoveryCode,
  verifyTotpCode,
} from "./auth";
import {
  AuthSecretAccessError,
  decryptAuthSecret,
  encryptAuthSecret,
} from "./auth-secrets";
import {
  AuthServiceError,
  type AuthStatus,
  buildAuthSecretOptions,
  buildTimestampOptions,
  type ConfiguredAuthUser,
  createSessionRecord,
  DEFAULT_TOTP_ISSUER,
  enforceConfiguredUserByUsername,
  hasTotpEnrollment,
  incrementFailedAttempts,
  type LoginInput,
  type LoginResult,
  normalizeSessionLifetimeDays,
  normalizeUsername,
  nowDate,
  type PrepareTotpEnrollmentInput,
  type RecoveryLoginInput,
  readCurrentAuthSettingsForUser,
  recordAuthAuditEvent,
  recordInvalidAuthAttempt,
  type SetupAuthInput,
  type SetupAuthResult,
  type TimestampOptions,
} from "./auth-service-core";
import { resolveSession } from "./auth-service-session";
import {
  countConfiguredAuthUsers,
  createUser,
  getUserByUsername,
  listAuthRecoveryCodes,
  listKnownAuthUsernames,
  markAuthRecoveryCodeUsed,
  replaceAuthRecoveryCodeHashes,
  resetAuthFailureState,
  type UserRecord,
  updateUserAdminStatus,
  upsertAuthSettings,
} from "./db";

function rethrowAuthSecretError(error: unknown): never {
  if (error instanceof AuthSecretAccessError) {
    throw new AuthServiceError("auth_secret_unavailable", error.message, 503);
  }
  throw error;
}

/**
 * Create the TOTP secret and URI needed for QR-code enrollment.
 */
export function prepareTotpEnrollment(
  input: PrepareTotpEnrollmentInput,
): Pick<AuthSetupMaterial, "totpSecret" | "totpUri"> {
  const totpSecret = generateTotpSecret();
  return {
    totpSecret,
    totpUri: buildTotpUri({
      accountName: input.accountName,
      issuer: input.issuer ?? DEFAULT_TOTP_ISSUER,
      secret: totpSecret,
    }),
  };
}

/**
 * Return the current auth status for the app and an optional session cookie.
 */
export function getAuthStatus(
  database: Database,
  sessionId: string | null,
  options: TimestampOptions = {},
): AuthStatus {
  const now = nowDate(options.nowMs);
  const knownUsernames = listKnownAuthUsernames(database);
  const session = sessionId
    ? resolveSession(database, {
        sessionId,
        ...buildTimestampOptions(options.nowMs),
      })
    : null;
  const settings =
    session === null
      ? null
      : readCurrentAuthSettingsForUser(database, session.userId, now);

  return {
    authenticated: options.devBypass === true || session !== null,
    configured: knownUsernames.length > 0,
    devBypass: options.devBypass === true,
    isAdmin: session?.isAdmin ?? false,
    knownUsernames,
    lockedUntil: session === null ? null : (settings?.lockedUntil ?? null),
    primaryFactorType:
      session === null ? null : (settings?.primaryFactorType ?? null),
    sessionExpiresAt: session?.expiresAt ?? null,
    username: session?.username ?? null,
  };
}

/**
 * Verify the configured primary factor and TOTP code without creating a session.
 * Shared by login, CLI recovery flows, and step-up verification paths.
 */
export async function verifyPrimaryFactorAndTotp(
  database: Database,
  input: LoginInput,
): Promise<ConfiguredAuthUser> {
  const now = nowDate(input.nowMs);
  const normalizedUsername = normalizeUsername(input.username);
  const { settings, user } = enforceConfiguredUserByUsername(
    database,
    normalizedUsername,
    now,
  );

  const primaryFactorValid = await verifyPrimaryFactor(
    input.primaryFactor,
    settings.primaryFactorHash,
  );
  if (!primaryFactorValid) {
    const failure = incrementFailedAttempts(database, user.id, now);
    recordInvalidAuthAttempt(database, {
      lockedUntil: failure.lockedUntil,
      method: "totp",
      primaryFactorType: settings.primaryFactorType,
    });

    if (failure.lockedUntil) {
      throw new AuthServiceError(
        "auth_locked",
        `Authentication is locked until ${failure.lockedUntil}.`,
        423,
        {
          lockedUntil: failure.lockedUntil,
        },
      );
    }

    throw new AuthServiceError(
      "invalid_credentials",
      "The provided credentials are invalid.",
      401,
    );
  }

  if (!hasTotpEnrollment(settings)) {
    throw new AuthServiceError(
      "totp_setup_required",
      "Complete authenticator setup to finish signing in.",
      409,
      {
        username: user.username,
      },
    );
  }

  let totpSecret: string;
  try {
    totpSecret = await decryptAuthSecret(
      settings.totpSecretCiphertext,
      buildAuthSecretOptions(input.appDataDir),
    );
  } catch (error) {
    rethrowAuthSecretError(error);
  }
  const totpValid = await verifyTotpCode(totpSecret, input.totpCode, {
    atMs: now.getTime(),
  });

  if (!totpValid) {
    recordInvalidAuthAttempt(database, {
      lockedUntil: null,
      method: "totp",
      primaryFactorType: settings.primaryFactorType,
    });

    throw new AuthServiceError(
      "invalid_credentials",
      "The provided credentials are invalid.",
      401,
    );
  }

  resetAuthFailureState(database, user.id);
  return {
    settings,
    user,
  };
}

/**
 * Verify the configured primary factor and consume one recovery code in place of TOTP.
 */
export async function verifyPrimaryFactorAndRecoveryCode(
  database: Database,
  input: RecoveryLoginInput,
): Promise<ConfiguredAuthUser> {
  const now = nowDate(input.nowMs);
  const normalizedUsername = normalizeUsername(input.username);
  const { settings, user } = enforceConfiguredUserByUsername(
    database,
    normalizedUsername,
    now,
  );
  const primaryFactorValid = await verifyPrimaryFactor(
    input.primaryFactor,
    settings.primaryFactorHash,
  );

  let matchingCodeHash: string | null = null;
  if (primaryFactorValid) {
    for (const record of listAuthRecoveryCodes(database, user.id)) {
      if (record.usedAt !== null) {
        continue;
      }
      if (await verifyRecoveryCode(input.recoveryCode, record.codeHash)) {
        matchingCodeHash = record.codeHash;
        break;
      }
    }
  }

  if (!primaryFactorValid || !matchingCodeHash) {
    if (!primaryFactorValid) {
      const failure = incrementFailedAttempts(database, user.id, now);
      recordInvalidAuthAttempt(database, {
        lockedUntil: failure.lockedUntil,
        method: "recovery_code",
        primaryFactorType: settings.primaryFactorType,
      });

      if (failure.lockedUntil) {
        throw new AuthServiceError(
          "auth_locked",
          `Authentication is locked until ${failure.lockedUntil}.`,
          423,
          {
            lockedUntil: failure.lockedUntil,
          },
        );
      }
    } else {
      recordInvalidAuthAttempt(database, {
        lockedUntil: null,
        method: "recovery_code",
        primaryFactorType: settings.primaryFactorType,
      });
    }

    if (primaryFactorValid && !hasTotpEnrollment(settings)) {
      throw new AuthServiceError(
        "totp_setup_required",
        "Complete authenticator setup to finish signing in.",
        409,
        {
          username: user.username,
        },
      );
    }

    throw new AuthServiceError(
      "invalid_credentials",
      "The provided credentials are invalid.",
      401,
    );
  }

  const markedUsed = markAuthRecoveryCodeUsed(
    database,
    matchingCodeHash,
    now.toISOString(),
    user.id,
  );
  if (!markedUsed) {
    throw new AuthServiceError(
      "invalid_credentials",
      "The provided credentials are invalid.",
      401,
    );
  }

  resetAuthFailureState(database, user.id);
  return {
    settings,
    user,
  };
}

/**
 * Complete first-run auth setup, persist settings, and create an authenticated session.
 */
export async function setupAuth(
  database: Database,
  input: SetupAuthInput,
): Promise<SetupAuthResult> {
  const normalizedUsername = normalizeUsername(input.username);
  const now = nowDate(input.nowMs);
  const configuredUserCount = countConfiguredAuthUsers(database);
  const existingUser = getUserByUsername(database, normalizedUsername);
  const existingSettings = existingUser
    ? readCurrentAuthSettingsForUser(database, existingUser.id, now)
    : null;
  if (existingSettings && hasTotpEnrollment(existingSettings)) {
    throw new AuthServiceError(
      "username_taken",
      `The username "${normalizedUsername}" is already configured.`,
      409,
    );
  }
  if (configuredUserCount > 0 && !existingUser) {
    throw new AuthServiceError(
      "admin_required",
      `Only administrators can create users. Ask the primary user to create "${normalizedUsername}" first.`,
      403,
    );
  }
  if (existingSettings?.lockedUntil) {
    throw new AuthServiceError(
      "auth_locked",
      `Authentication is locked until ${existingSettings.lockedUntil}.`,
      423,
      {
        lockedUntil: existingSettings.lockedUntil,
      },
    );
  }
  const totpValid = await verifyTotpCode(input.totpSecret, input.totpCode, {
    atMs: now.getTime(),
  });
  if (!totpValid) {
    throw new AuthServiceError(
      "invalid_credentials",
      "The provided TOTP code is invalid.",
      401,
    );
  }

  let totpSecretCiphertext: string;
  try {
    totpSecretCiphertext = await encryptAuthSecret(
      input.totpSecret,
      buildAuthSecretOptions(input.appDataDir),
    );
  } catch (error) {
    rethrowAuthSecretError(error);
  }
  const requestedSessionLifetimeDays = normalizeSessionLifetimeDays(
    input.sessionLifetimeDays,
  );
  const recoveryCodes = generateRecoveryCodes();
  const recoveryCodeHashes = await Promise.all(
    recoveryCodes.map((code) => hashRecoveryCode(code)),
  );
  let primaryFactorHash: string;
  let primaryFactorType: "password" | "pin";
  let sessionLifetimeDays: number;
  let user: UserRecord;

  if (existingUser && existingSettings) {
    const primaryFactorValid = await verifyPrimaryFactor(
      input.primaryFactor,
      existingSettings.primaryFactorHash,
    );
    if (!primaryFactorValid) {
      const failure = incrementFailedAttempts(database, existingUser.id, now);
      recordInvalidAuthAttempt(database, {
        lockedUntil: failure.lockedUntil,
        method: "totp",
        primaryFactorType: existingSettings.primaryFactorType,
      });

      if (failure.lockedUntil) {
        throw new AuthServiceError(
          "auth_locked",
          `Authentication is locked until ${failure.lockedUntil}.`,
          423,
          {
            lockedUntil: failure.lockedUntil,
          },
        );
      }

      throw new AuthServiceError(
        "invalid_credentials",
        "The provided credentials are invalid.",
        401,
      );
    }

    resetAuthFailureState(database, existingUser.id);
    primaryFactorHash = existingSettings.primaryFactorHash;
    primaryFactorType = existingSettings.primaryFactorType;
    sessionLifetimeDays = existingSettings.sessionLifetimeDays;
    user = existingUser;
  } else {
    primaryFactorHash = await hashPrimaryFactor(
      input.primaryFactorType,
      input.primaryFactor,
    );
    primaryFactorType = input.primaryFactorType;
    sessionLifetimeDays = requestedSessionLifetimeDays;
    user = existingUser
      ? configuredUserCount === 0 && !existingUser.isAdmin
        ? updateUserAdminStatus(database, existingUser.id, true)
        : existingUser
      : createUser(database, {
          isAdmin: configuredUserCount === 0,
          username: normalizedUsername,
        });
  }

  upsertAuthSettings(database, {
    primaryFactorHash,
    primaryFactorType,
    sessionLifetimeDays,
    totpSecretCiphertext,
    userId: user.id,
  });
  replaceAuthRecoveryCodeHashes(database, recoveryCodeHashes, user.id);
  const session = await createSessionRecord(
    database,
    user.id,
    sessionLifetimeDays,
    now,
  );
  recordAuthAuditEvent(database, {
    eventType: "auth_configured",
    payload: {
      primaryFactorType,
      sessionLifetimeDays,
      userId: user.id,
      username: user.username,
      isAdmin: user.isAdmin,
    },
    summaryText:
      "Authentication was configured for a user and a session was created.",
  });

  return {
    recoveryCodes,
    session,
  };
}

/**
 * Create a regular pending user who must finish auth setup later.
 */
export async function createPendingUser(
  database: Database,
  input: {
    actorUserId?: number | null;
    actorUsername?: string | null;
    pin: string;
    username: string;
  },
): Promise<UserRecord> {
  if (countConfiguredAuthUsers(database) === 0) {
    throw new AuthServiceError(
      "auth_not_configured",
      "Configure the primary user before creating additional users.",
      409,
    );
  }

  const normalizedUsername = normalizeUsername(input.username);
  const existingUser = getUserByUsername(database, normalizedUsername);
  if (existingUser) {
    throw new AuthServiceError(
      "username_taken",
      `The username "${normalizedUsername}" already exists.`,
      409,
    );
  }

  const user = createUser(database, {
    isAdmin: false,
    username: normalizedUsername,
  });
  upsertAuthSettings(database, {
    primaryFactorHash: await hashPrimaryFactor("pin", input.pin),
    primaryFactorType: "pin",
    sessionLifetimeDays: DEFAULT_SESSION_LIFETIME_DAYS,
    totpSecretCiphertext: "",
    userId: user.id,
  });
  recordAuthAuditEvent(database, {
    eventType: "user_created",
    payload: {
      createdByUserId: input.actorUserId ?? null,
      createdByUsername: input.actorUsername ?? null,
      isAdmin: user.isAdmin,
      userId: user.id,
      username: user.username,
    },
    summaryText:
      "A regular user account was created with an assigned PIN and pending authenticator setup.",
  });
  return user;
}

/**
 * Authenticate a user with their primary factor and mandatory TOTP code.
 */
export async function login(
  database: Database,
  input: LoginInput,
): Promise<LoginResult> {
  const now = nowDate(input.nowMs);
  const { settings, user } = await verifyPrimaryFactorAndTotp(database, input);
  const session = await createSessionRecord(
    database,
    user.id,
    settings.sessionLifetimeDays,
    now,
  );
  recordAuthAuditEvent(database, {
    eventType: "auth_login",
    payload: {
      method: "totp",
      primaryFactorType: settings.primaryFactorType,
      userId: user.id,
      username: user.username,
    },
    summaryText: "Authenticated with the configured primary factor and TOTP.",
  });
  return {
    session,
  };
}

/**
 * Authenticate a user with their primary factor plus a single-use recovery code.
 */
export async function loginWithRecoveryCode(
  database: Database,
  input: RecoveryLoginInput,
): Promise<LoginResult> {
  const now = nowDate(input.nowMs);
  const { settings, user } = await verifyPrimaryFactorAndRecoveryCode(
    database,
    input,
  );
  const session = await createSessionRecord(
    database,
    user.id,
    settings.sessionLifetimeDays,
    now,
  );
  recordAuthAuditEvent(database, {
    eventType: "recovery_code_login",
    payload: {
      method: "recovery_code",
      primaryFactorType: settings.primaryFactorType,
      userId: user.id,
      username: user.username,
    },
    summaryText:
      "Authenticated with the configured primary factor and a recovery code.",
  });
  return {
    session,
  };
}
