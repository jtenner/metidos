/**
 * @file src/mainview/app/browser-storage.ts
 * @description Safe browser storage helpers that report write failures.
 */

import { logClientError } from "../client-logging";

function storageContext(context: string, key: string): string {
  return `${context}:${key}`;
}

export function safeLocalStorageSetItem(
  key: string,
  value: string,
  context: string,
): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch (error) {
    logClientError("Failed to write localStorage item", error, {
      context: storageContext(context, key),
    });
    return false;
  }
}

export function safeLocalStorageRemoveItem(
  key: string,
  context: string,
): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    window.localStorage.removeItem(key);
    return true;
  } catch (error) {
    logClientError("Failed to remove localStorage item", error, {
      context: storageContext(context, key),
    });
    return false;
  }
}
