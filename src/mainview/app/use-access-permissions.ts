/**
 * @file src/mainview/app/use-access-permissions.ts
 * @description Shared access-permission state and update helpers.
 */

import { useCallback, useMemo, useState } from "react";
import type { RpcCronJob, RpcThread } from "../../bun/rpc-schema";
import {
  DEFAULT_THREAD_ACCESS_PROJECTION,
  LEGACY_THREAD_ACCESS_PERMISSION_IDS,
  projectThreadAccessControl,
} from "../../shared/thread-access-projection";
import type { ThreadAccessValue } from "../controls/thread-access-control";

export type AccessPermissions = Required<ThreadAccessValue> & {
  permissions: string[];
};
export type AccessPermissionKey = keyof AccessPermissions;
type BooleanAccessPermissionKey =
  keyof typeof LEGACY_THREAD_ACCESS_PERMISSION_IDS;

const DEFAULT_ACCESS_PERMISSIONS: AccessPermissions =
  DEFAULT_THREAD_ACCESS_PROJECTION;

export function normalizeAccessPermissions(
  access: ThreadAccessValue,
): AccessPermissions {
  return projectThreadAccessControl(access);
}

export function accessPermissionsFromThread(
  thread: RpcThread,
): AccessPermissions {
  return normalizeAccessPermissions({
    permissions: thread.permissions ?? [],
    pluginAccessGroups: thread.pluginAccessGroups ?? [],
    webSearchAccess: thread.webSearchAccess,
    githubAccess: thread.githubAccess,
    gitAccess: thread.gitAccess ?? false,
    sqliteAccess: thread.sqliteAccess ?? false,
    webServerAccess: thread.webServerAccess ?? false,
    agentsAccess: thread.agentsAccess,
    calendarAccess: thread.calendarAccess ?? false,
    notificationsAccess: thread.notificationsAccess ?? false,
    weatherAccess: thread.weatherAccess ?? false,
    threadsAccess: thread.threadsAccess ?? thread.metidosAccess,
    cronsAccess: thread.cronsAccess ?? thread.metidosAccess,
    metidosAccess:
      (thread.threadsAccess ?? thread.metidosAccess) ||
      (thread.cronsAccess ?? thread.metidosAccess),
    unsafeMode: thread.unsafeMode,
  });
}

export function accessPermissionsFromCronJob(
  cronJob: RpcCronJob,
): AccessPermissions {
  return normalizeAccessPermissions({
    permissions: cronJob.permissions ?? [],
    pluginAccessGroups: cronJob.pluginAccessGroups ?? [],
    webSearchAccess: cronJob.webSearchAccess,
    githubAccess: cronJob.githubAccess,
    gitAccess: cronJob.gitAccess ?? false,
    sqliteAccess: cronJob.sqliteAccess ?? false,
    webServerAccess: cronJob.webServerAccess ?? false,
    agentsAccess: cronJob.agentsAccess,
    calendarAccess: cronJob.calendarAccess ?? false,
    notificationsAccess: cronJob.notificationsAccess ?? false,
    weatherAccess: cronJob.weatherAccess ?? false,
    threadsAccess: cronJob.threadsAccess ?? cronJob.metidosAccess,
    cronsAccess: cronJob.cronsAccess ?? cronJob.metidosAccess,
    metidosAccess:
      (cronJob.threadsAccess ?? cronJob.metidosAccess) ||
      (cronJob.cronsAccess ?? cronJob.metidosAccess),
    unsafeMode: cronJob.unsafeMode,
  });
}

export function accessPermissionsEqual(
  left: ThreadAccessValue,
  right: ThreadAccessValue,
): boolean {
  const normalizedLeft = normalizeAccessPermissions(left);
  const normalizedRight = normalizeAccessPermissions(right);
  return (Object.keys(normalizedLeft) as AccessPermissionKey[]).every((key) => {
    if (key === "pluginAccessGroups" || key === "permissions") {
      const leftValues = normalizedLeft[key];
      const rightValues = normalizedRight[key];
      return (
        leftValues.length === rightValues.length &&
        leftValues.every((value, index) => value === rightValues[index])
      );
    }
    return normalizedLeft[key] === normalizedRight[key];
  });
}

type UseAccessPermissionsParams = {
  initialAccess?: Partial<ThreadAccessValue>;
  onChange?: (access: AccessPermissions) => void;
  value?: ThreadAccessValue;
};

export function useAccessPermissions({
  initialAccess,
  onChange,
  value,
}: UseAccessPermissionsParams = {}) {
  const [internalAccess, setInternalAccess] = useState<AccessPermissions>(() =>
    normalizeAccessPermissions({
      ...DEFAULT_ACCESS_PERMISSIONS,
      ...initialAccess,
    }),
  );
  const access = useMemo(
    () => (value ? normalizeAccessPermissions(value) : internalAccess),
    [internalAccess, value],
  );

  const setAccess = useCallback(
    (nextAccess: ThreadAccessValue): void => {
      const normalizedNextAccess = normalizeAccessPermissions(nextAccess);
      if (onChange) {
        onChange(normalizedNextAccess);
        return;
      }
      setInternalAccess(normalizedNextAccess);
    },
    [onChange],
  );

  const setPermission = useCallback(
    (permission: string, nextValue: boolean): void => {
      const permissions = new Set(access.permissions);
      if (nextValue) {
        permissions.add(permission);
      } else {
        permissions.delete(permission);
      }
      const nextPermissions = [...permissions].sort((left, right) =>
        left.localeCompare(right),
      );
      setAccess({
        ...access,
        ...projectThreadAccessControl({
          permissions: nextPermissions,
          pluginAccessGroups: access.pluginAccessGroups,
        }),
      });
    },
    [access, setAccess],
  );

  const setAccessPermission = useCallback(
    (key: BooleanAccessPermissionKey, nextValue: boolean): void => {
      setPermission(LEGACY_THREAD_ACCESS_PERMISSION_IDS[key], nextValue);
    },
    [setPermission],
  );

  const callbacks = useMemo(
    () => ({
      setPermission,
      setWebSearchAccess: (value: boolean) => {
        setAccessPermission("webSearchAccess", value);
      },
      setGithubAccess: (value: boolean) => {
        setAccessPermission("githubAccess", value);
      },
      setGitAccess: (value: boolean) => {
        setAccessPermission("gitAccess", value);
      },
      setSqliteAccess: (value: boolean) => {
        setAccessPermission("sqliteAccess", value);
      },
      setWebServerAccess: (value: boolean) => {
        setAccessPermission("webServerAccess", value);
      },
      setAgentsAccess: (value: boolean) => {
        setAccessPermission("agentsAccess", value);
      },
      setCalendarAccess: (value: boolean) => {
        setAccessPermission("calendarAccess", value);
      },
      setNotificationsAccess: (value: boolean) => {
        setAccessPermission("notificationsAccess", value);
      },
      setWeatherAccess: (_value: boolean) => {},
      setThreadsAccess: (value: boolean) => {
        setAccessPermission("threadsAccess", value);
      },
      setCronsAccess: (value: boolean) => {
        setAccessPermission("cronsAccess", value);
      },
      setMetidosAccess: (value: boolean) => {
        const permissions = new Set(access.permissions);
        for (const permission of ["metidos:threads", "metidos:crons"]) {
          if (value) {
            permissions.add(permission);
          } else {
            permissions.delete(permission);
          }
        }
        const nextPermissions = [...permissions].sort((left, right) =>
          left.localeCompare(right),
        );
        setAccess({
          ...access,
          permissions: nextPermissions,
          threadsAccess: value,
          cronsAccess: value,
          metidosAccess: value,
        });
      },
      setPluginAccessGroup: (key: string, value: boolean) => {
        const groups = new Set(access.pluginAccessGroups);
        if (value) {
          groups.add(key);
        } else {
          groups.delete(key);
        }
        const [providerId, accessId] = key.split("/");
        const permissions = new Set(access.permissions);
        if (providerId && accessId) {
          const permission = `${providerId}:${accessId}`;
          if (value) {
            permissions.add(permission);
          } else {
            permissions.delete(permission);
          }
        }
        setAccess({
          ...access,
          permissions: [...permissions].sort((left, right) =>
            left.localeCompare(right),
          ),
          pluginAccessGroups: [...groups].sort((left, right) =>
            left.localeCompare(right),
          ),
        });
      },
      setUnsafeMode: (value: boolean) => {
        setAccessPermission("unsafeMode", value);
      },
    }),
    [access, setAccess, setAccessPermission, setPermission],
  );

  return { access, setAccess, ...callbacks };
}
