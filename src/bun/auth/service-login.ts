/**
 * @file src/bun/auth/service-login.ts
 * @description Setup, login, recovery, and auth-status flows.
 */

import type { Database } from "bun:sqlite";
import {
  countConfiguredAuthUsers,
  createUser,
  getUserByUsername,
  listAuthRecoveryCodes,
  listKnownAuthUsernames,
  markAuthRecoveryCodeUsed,
  replaceAuthRecoveryCodeHashes,
  resetAuthFailureState,
  tryAdvanceTotpLastUsedCounter,
  type UserRecord,
  upsertAuthSettings,
} from "../db";
import {
  type AuthSetupMaterial,
  buildTotpUri,
  encodeStoredTotpSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  hashPrimaryFactor,
  hashRecoveryCode,
  parseStoredTotpSecret,
  verifyPrimaryFactor,
  verifyRecoveryCode,
  verifyTotpCode,
  verifyTotpMatchedCounter,
} from "./";
import {
  AUTH_TOTP_SECRET_PURPOSE,
  AuthSecretAccessError,
  type AuthSecretOptions,
  buildLocalOperatorAuthSecretAdditionalData,
  decryptAuthSecret,
  encryptAuthSecret,
} from "./secrets";
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
  nowDate,
  type PrepareTotpEnrollmentInput,
  type RecoveryLoginInput,
  readCurrentAuthSettingsForUser,
  recordAuthAuditEvent,
  recordInvalidAuthAttempt,
  type SetupAuthInput,
  type SetupAuthResult,
  type TimestampOptions,
} from "./service-core";
import { resolveSession } from "./service-session";
import { normalizeUsername, normalizeWorkspaceHomeUsername } from "./usernames";

const DEFAULT_LOCAL_OPERATOR_USERNAME = "metidos";
const DEFAULT_TOTP_ACCOUNT_NAME = "Metidos";

function rethrowAuthSecretError(error: unknown): never {
  if (error instanceof AuthSecretAccessError) {
    throw new AuthServiceError("auth_secret_unavailable", error.message, 503);
  }
  throw error;
}

function buildTotpAuthSecretOptions(
  _userId: number,
  appDataDir?: string,
): AuthSecretOptions {
  return {
    ...buildAuthSecretOptions(appDataDir),
    additionalData: buildLocalOperatorAuthSecretAdditionalData(
      AUTH_TOTP_SECRET_PURPOSE,
    ),
  };
}

// This is a last-resort per-Database backpressure guard for serialized setup
// transactions. Public auth routes hit peer/subject rate limits before this
// queue, so a 503 here means the local SQLite writer is already saturated.
const MAX_IMMEDIATE_TRANSACTION_QUEUE_DEPTH = 100;
const immediateTransactionQueues = new WeakMap<Database, Promise<void>>();
const immediateTransactionQueueDepths = new WeakMap<Database, number>();

async function runInImmediateTransaction<T>(
  database: Database,
  callback: () => Promise<T>,
): Promise<T> {
  // Auth setup/login retries are deliberately handled by SQLite's busy_timeout
  // and this per-Database queue instead of a second ad hoc retry loop: if
  // BEGIN IMMEDIATE still fails after the configured busy wait, surfacing a
  // transient 503 preserves the single-writer invariant rather than replaying
  // credential verification work outside the serialized section.
  const pendingDepth = immediateTransactionQueueDepths.get(database) ?? 0;
  if (pendingDepth >= MAX_IMMEDIATE_TRANSACTION_QUEUE_DEPTH) {
    throw new AuthServiceError(
      "rate_limited",
      "Too many authentication requests are queued. Try again later.",
      503,
    );
  }
  immediateTransactionQueueDepths.set(database, pendingDepth + 1);
  const previous =
    immediateTransactionQueues.get(database) ?? Promise.resolve();
  let releaseQueue!: () => void;
  const current = new Promise<void>((resolve) => {
    releaseQueue = resolve;
  });
  const queued = previous.then(
    () => current,
    () => current,
  );
  immediateTransactionQueues.set(database, queued);

  await previous.catch(() => {
    // Preserve queue ordering without inheriting another caller's failure:
    // earlier queued callers surface their own errors, while later callers only
    // need serialized access to the shared SQLite connection. Queue-depth
    // accounting is balanced in each caller's finally block, so a prior
    // rejection does not let later auth transactions run concurrently, leak a
    // depth slot, or observe the wrong error.
  });

  try {
    database.run("BEGIN IMMEDIATE");
    try {
      const result = await callback();
      database.run("COMMIT");
      return result;
    } catch (error) {
      try {
        database.run("ROLLBACK");
      } catch {
        // Preserve the original setup/login error if rollback also fails.
      }
      throw error;
    }
  } finally {
    releaseQueue();
    const currentDepth = immediateTransactionQueueDepths.get(database) ?? 1;
    if (currentDepth <= 1) {
      immediateTransactionQueueDepths.delete(database);
    } else {
      immediateTransactionQueueDepths.set(database, currentDepth - 1);
    }
    if (immediateTransactionQueues.get(database) === queued) {
      immediateTransactionQueues.delete(database);
    }
  }
}

export async function findMatchingUnusedRecoveryCodeHash(
  records: Array<{
    codeHash: string;
    usedAt: string | null;
  }>,
  recoveryCode: string,
  verify: (code: string, hash: string) => Promise<boolean>,
): Promise<string | null> {
  let matchingCodeHash: string | null = null;
  // Always verify against every stored recovery-code hash. That intentionally
  // avoids leaking which unused code matched by loop count or early return. The
  // Argon2 fan-out is an accepted CPU cost because the recovery-code set is
  // small and fixed by provisioning defaults, login attempts are rate-limited,
  // and callers only run this after the primary factor succeeds.
  for (const record of records) {
    const matches = await verify(recoveryCode, record.codeHash);
    if (matches && record.usedAt === null && matchingCodeHash === null) {
      matchingCodeHash = record.codeHash;
    }
  }
  return matchingCodeHash;
}

function normalizeUsernameForAuthInput(username: string): string {
  try {
    return normalizeUsername(username);
  } catch (error) {
    throw new AuthServiceError(
      "invalid_username",
      error instanceof Error ? error.message : "Username is invalid.",
      400,
    );
  }
}

function normalizeNewUsernameForProvisioning(username: string): string {
  try {
    return normalizeWorkspaceHomeUsername(username);
  } catch (error) {
    throw new AuthServiceError(
      "invalid_username",
      error instanceof Error ? error.message : "Username is invalid.",
      400,
    );
  }
}

function resolveSingleOperatorUsername(database: Database): string {
  const knownUsernames = listKnownAuthUsernames(database);
  if (knownUsernames.length === 0) {
    return DEFAULT_LOCAL_OPERATOR_USERNAME;
  }
  if (knownUsernames.length === 1) {
    return knownUsernames[0] ?? DEFAULT_LOCAL_OPERATOR_USERNAME;
  }
  throw new AuthServiceError(
    "invalid_credentials",
    "Sign in requires a username on this installation.",
    409,
  );
}

function resolveAuthInputUsername(
  database: Database,
  username: string | undefined,
): string {
  const trimmedUsername = username?.trim() ?? "";
  if (trimmedUsername) {
    return normalizeUsernameForAuthInput(trimmedUsername);
  }
  return resolveSingleOperatorUsername(database);
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
      accountName: input.accountName?.trim() || DEFAULT_TOTP_ACCOUNT_NAME,
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
    authenticated: session !== null,
    configured: knownUsernames.length > 0,
    isAdmin: session?.isAdmin ?? false,
    knownUsernames: session?.username ? [session.username] : [],
    lockedUntil: session === null ? null : (settings?.lockedUntil ?? null),
    primaryFactorType:
      session === null ? null : (settings?.primaryFactorType ?? null),
    sessionExpiresAt: session?.expiresAt ?? null,
    username: session?.username ?? null,
  };
}

/**
 * Verify the configured primary factor and TOTP code without creating a session.
 * Shared by login and CLI recovery flows.
 */
export async function verifyPrimaryFactorAndTotp(
  database: Database,
  input: LoginInput,
): Promise<ConfiguredAuthUser> {
  const now = nowDate(input.nowMs);
  const normalizedUsername = resolveAuthInputUsername(database, input.username);
  const { settings, user } = enforceConfiguredUserByUsername(
    database,
    normalizedUsername,
    now,
  );

  const primaryFactorValid = await verifyPrimaryFactor(
    input.primaryFactor,
    settings.primaryFactorHash,
  );

  let totpValid = false;
  if (hasTotpEnrollment(settings)) {
    let totpSecret: string;
    try {
      totpSecret = await decryptAuthSecret(
        settings.totpSecretCiphertext,
        buildTotpAuthSecretOptions(user.id, input.appDataDir),
      );
    } catch (error) {
      rethrowAuthSecretError(error);
    }
    const parsedTotpSecret = parseStoredTotpSecret(totpSecret);
    const matchedCounter = await verifyTotpMatchedCounter(
      parsedTotpSecret.secret,
      input.totpCode,
      {
        algorithm: parsedTotpSecret.algorithm,
        atMs: now.getTime(),
      },
    );
    totpValid =
      matchedCounter !== null &&
      tryAdvanceTotpLastUsedCounter(database, matchedCounter, user.id);
  } else if (primaryFactorValid) {
    // This branch deliberately appears only after a valid primary factor: the
    // setup-required response is an authenticated recovery path, not a username
    // or TOTP-enrollment oracle for invalid password/PIN attempts.
    throw new AuthServiceError(
      "totp_setup_required",
      "Complete authenticator setup to finish signing in.",
      409,
      {
        username: user.username,
      },
    );
  }

  if (!primaryFactorValid || !totpValid) {
    const failure = incrementFailedAttempts(database, user.id, now);
    recordInvalidAuthAttempt(database, {
      lockedUntil: failure.lockedUntil,
      method: "totp",
      primaryFactorType: settings.primaryFactorType,
    });

    if (failure.lockedUntil) {
      throw new AuthServiceError(
        "auth_locked",
        "Too many failed authentication attempts. Try again later.",
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
  const normalizedUsername = resolveAuthInputUsername(database, input.username);
  const { settings, user } = enforceConfiguredUserByUsername(
    database,
    normalizedUsername,
    now,
  );
  const primaryFactorValid = await verifyPrimaryFactor(
    input.primaryFactor,
    settings.primaryFactorHash,
  );

  const matchingCodeHash = primaryFactorValid
    ? await findMatchingUnusedRecoveryCodeHash(
        listAuthRecoveryCodes(database, user.id),
        input.recoveryCode,
        verifyRecoveryCode,
      )
    : null;

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
          "Too many failed authentication attempts. Try again later.",
          423,
          {
            lockedUntil: failure.lockedUntil,
          },
        );
      }
    } else {
      const failure = incrementFailedAttempts(database, user.id, now);
      recordInvalidAuthAttempt(database, {
        lockedUntil: failure.lockedUntil,
        method: "recovery_code",
        primaryFactorType: settings.primaryFactorType,
      });

      if (failure.lockedUntil) {
        throw new AuthServiceError(
          "auth_locked",
          "Too many failed authentication attempts. Try again later.",
          423,
          {
            lockedUntil: failure.lockedUntil,
          },
        );
      }
    }

    if (primaryFactorValid && !hasTotpEnrollment(settings)) {
      // As above, disclose setup-required state only after proving the primary
      // factor; invalid recovery-code attempts remain generic credentials
      // failures so enrollment state is not exposed to unauthenticated callers.
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

  // Keep the consume step conditional in SQL. A concurrent request that finds
  // the same unused hash first cannot reuse it: markAuthRecoveryCodeUsed only
  // succeeds while used_at IS NULL, and this path intentionally returns the
  // generic credential error if another request wins the race.
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
  const lookupUsername = resolveAuthInputUsername(database, input.username);
  const now = nowDate(input.nowMs);
  const configuredUserCount = countConfiguredAuthUsers(database);
  const existingUser = getUserByUsername(database, lookupUsername);
  if (existingUser && !existingUser.enabled) {
    throw new AuthServiceError(
      "user_disabled",
      "The user account is disabled.",
      403,
    );
  }
  const normalizedUsername = existingUser
    ? lookupUsername
    : normalizeNewUsernameForProvisioning(lookupUsername);
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
  if (existingUser && !existingSettings) {
    throw new AuthServiceError(
      "auth_not_configured",
      `The username "${normalizedUsername}" cannot be configured because its authentication settings are missing.`,
      409,
    );
  }
  if (configuredUserCount > 0 && !existingUser) {
    throw new AuthServiceError(
      "username_taken",
      `Authentication is already configured for the local operator. Use the configured username instead of "${normalizedUsername}".`,
      409,
    );
  }
  if (existingSettings?.lockedUntil) {
    throw new AuthServiceError(
      "auth_locked",
      "Too many failed authentication attempts. Try again later.",
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
          "Too many failed authentication attempts. Try again later.",
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

    primaryFactorHash = existingSettings.primaryFactorHash;
    primaryFactorType = existingSettings.primaryFactorType;
    sessionLifetimeDays = existingSettings.sessionLifetimeDays;
  } else {
    primaryFactorHash = await hashPrimaryFactor(
      input.primaryFactorType,
      input.primaryFactor,
    );
    primaryFactorType = input.primaryFactorType;
    sessionLifetimeDays = requestedSessionLifetimeDays;
  }

  const session = await runInImmediateTransaction(database, async () => {
    let user: UserRecord;

    if (existingUser && existingSettings) {
      const currentSettings = readCurrentAuthSettingsForUser(
        database,
        existingUser.id,
        now,
      );
      if (!currentSettings) {
        throw new AuthServiceError(
          "auth_not_configured",
          `The username "${normalizedUsername}" cannot be configured because its authentication settings are missing.`,
          409,
        );
      }
      if (hasTotpEnrollment(currentSettings)) {
        throw new AuthServiceError(
          "username_taken",
          `The username "${normalizedUsername}" is already configured.`,
          409,
        );
      }
      resetAuthFailureState(database, existingUser.id);
      user = existingUser;
    } else {
      // Recheck inside the serialized immediate transaction because the
      // initial configured-user count was read before async TOTP/Argon2 work;
      // this closes the first-run setup race without trusting the stale preflight.
      const firstConfiguredUserStillAvailable =
        countConfiguredAuthUsers(database) === 0;
      if (!firstConfiguredUserStillAvailable) {
        throw new AuthServiceError(
          "username_taken",
          `Authentication is already configured for the local operator. Use the configured username instead of "${normalizedUsername}".`,
          409,
        );
      }
      const concurrentlyCreatedUser = getUserByUsername(
        database,
        normalizedUsername,
      );
      if (concurrentlyCreatedUser) {
        throw new AuthServiceError(
          "username_taken",
          `The username "${normalizedUsername}" is already configured.`,
          409,
        );
      }
      user = createUser(database, {
        isAdmin: true,
        username: normalizedUsername,
      });
    }

    let totpSecretCiphertext: string;
    try {
      totpSecretCiphertext = await encryptAuthSecret(
        encodeStoredTotpSecret(input.totpSecret),
        buildTotpAuthSecretOptions(user.id, input.appDataDir),
      );
    } catch (error) {
      rethrowAuthSecretError(error);
    }

    upsertAuthSettings(database, {
      primaryFactorHash,
      primaryFactorType,
      sessionLifetimeDays,
      totpSecretCiphertext,
      userId: user.id,
    });
    replaceAuthRecoveryCodeHashes(database, recoveryCodeHashes, user.id);
    const createdSession = await createSessionRecord(
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
        "Authentication was configured for the local operator and a session was created.",
    });
    return createdSession;
  });

  return {
    recoveryCodes,
    session,
  };
}

/**
 * Legacy provisioning entrypoint; disabled for single-operator Metidos.
 */
export async function createPendingUser(
  _database: Database,
  _input: {
    actorUserId?: number | null;
    actorUsername?: string | null;
    pin: string;
    username: string;
  },
): Promise<UserRecord> {
  throw new AuthServiceError(
    "forbidden",
    "Metidos now supports a single local operator only.",
    409,
  );
}

/**
 * Authenticate the local operator with their primary factor and mandatory TOTP code.
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
 * Authenticate the local operator with their primary factor plus a single-use recovery code.
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
