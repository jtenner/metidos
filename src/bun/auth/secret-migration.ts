/**
 * @file src/bun/auth/secret-migration.ts
 * @description Startup migration helpers for persisted auth secrets.
 */

import type { Database } from "bun:sqlite";

import {
  AUTH_TOTP_SECRET_PURPOSE,
  type AuthSecretOptions,
  buildLocalOperatorAuthSecretAdditionalData,
  decryptLegacyAuthSecretForMigration,
  encryptAuthSecret,
} from "./secrets";
import { buildAuthSecretOptions } from "./service-core";

type TotpCiphertextRow = {
  totpSecretCiphertext: string;
};

type TotpAuthSecretMigrationResult = {
  migrated: number;
  scanned: number;
};

function isLegacyAuthSecretCiphertext(ciphertext: string): boolean {
  return ciphertext.trim().startsWith("v1.");
}

function buildTotpSecretOptions(appDataDir?: string): AuthSecretOptions {
  return {
    ...buildAuthSecretOptions(appDataDir),
    additionalData: buildLocalOperatorAuthSecretAdditionalData(
      AUTH_TOTP_SECRET_PURPOSE,
    ),
  };
}

/**
 * Rewrap legacy TOTP ciphertexts with local-operator AES-GCM AAD.
 *
 * Existing v1 ciphertexts were encrypted without AAD, so the migration decrypts
 * them with the legacy contract and immediately stores v2 ciphertexts bound to
 * the local operator and TOTP purpose label. This must run before auth requests
 * are accepted so normal TOTP verification can require the v2 AAD contract.
 */
export async function migrateTotpAuthSecretsOnStartup(
  database: Database,
  options: {
    appDataDir?: string;
  } = {},
): Promise<TotpAuthSecretMigrationResult> {
  const rows = database
    .query<TotpCiphertextRow, []>(
      `
        SELECT
          totp_secret_ciphertext AS totpSecretCiphertext
        FROM auth_settings
        WHERE length(trim(totp_secret_ciphertext)) > 0
        ORDER BY id ASC
      `,
    )
    .all();

  let migrated = 0;
  for (const row of rows) {
    const existingCiphertext = row.totpSecretCiphertext.trim();
    if (!isLegacyAuthSecretCiphertext(existingCiphertext)) {
      continue;
    }

    const plaintext = await decryptLegacyAuthSecretForMigration(
      existingCiphertext,
      buildAuthSecretOptions(options.appDataDir),
    );
    const rewrappedCiphertext = await encryptAuthSecret(
      plaintext,
      buildTotpSecretOptions(options.appDataDir),
    );
    const result = database.run(
      `
        UPDATE auth_settings
        SET
          totp_secret_ciphertext = ?,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = 1
          AND totp_secret_ciphertext = ?
      `,
      [rewrappedCiphertext, row.totpSecretCiphertext],
    );
    if (result.changes > 0) {
      migrated += 1;
    }
  }

  return {
    migrated,
    scanned: rows.length,
  };
}
