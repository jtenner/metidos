/**
 * @file src/shared/thread-access-projection.ts
 * @description Canonical Thread Access Control projection helpers shared by Backend and Mainview.
 */

export type LegacyThreadAccessBooleans = {
  agentsAccess: boolean;
  calendarAccess: boolean;
  cronsAccess: boolean;
  gitAccess: boolean;
  githubAccess: boolean;
  metidosAccess: boolean;
  notificationsAccess: boolean;
  sqliteAccess: boolean;
  threadsAccess: boolean;
  unsafeMode: boolean;
  webSearchAccess: boolean;
  webServerAccess: boolean;
  weatherAccess: boolean;
};

export type ThreadAccessProjection = LegacyThreadAccessBooleans & {
  permissions: string[];
  pluginAccessGroups: string[];
};

export type ThreadAccessProjectionInput = {
  [Key in keyof LegacyThreadAccessBooleans]?:
    | LegacyThreadAccessBooleans[Key]
    | null;
} & {
  permissions?: readonly string[] | null;
  pluginAccessGroups?: readonly string[] | null;
};

export type LegacyThreadAccessProjectionOptions = {
  defaultLegacyAccess?: boolean;
};

export const DEFAULT_THREAD_ACCESS_PERMISSION_IDS = [
  "metidos:crons",
  "metidos:threads",
  "metidos:web-search",
] as const;

export const LEGACY_THREAD_ACCESS_PERMISSION_IDS = {
  agentsAccess: "metidos:agents",
  calendarAccess: "metidos:calendar",
  cronsAccess: "metidos:crons",
  gitAccess: "metidos:git",
  githubAccess: "metidos:github",
  notificationsAccess: "metidos:notifications",
  sqliteAccess: "metidos:sqlite",
  threadsAccess: "metidos:threads",
  unsafeMode: "metidos:unsafe",
  webSearchAccess: "metidos:web-search",
  webServerAccess: "metidos:webserver",
} as const satisfies Partial<Record<keyof LegacyThreadAccessBooleans, string>>;

export const DEFAULT_THREAD_ACCESS_PROJECTION: ThreadAccessProjection = {
  permissions: [...DEFAULT_THREAD_ACCESS_PERMISSION_IDS],
  pluginAccessGroups: [],
  agentsAccess: false,
  calendarAccess: false,
  cronsAccess: true,
  gitAccess: false,
  githubAccess: false,
  metidosAccess: true,
  notificationsAccess: false,
  sqliteAccess: false,
  threadsAccess: true,
  unsafeMode: false,
  webSearchAccess: true,
  webServerAccess: false,
  weatherAccess: false,
};

const LEGACY_PERMISSION_ACCESS_KEYS = Object.entries(
  LEGACY_THREAD_ACCESS_PERMISSION_IDS,
).reduce(
  (result, [key, permission]) => {
    result[permission] =
      key as keyof typeof LEGACY_THREAD_ACCESS_PERMISSION_IDS;
    return result;
  },
  {} as Record<string, keyof typeof LEGACY_THREAD_ACCESS_PERMISSION_IDS>,
);

export function normalizeThreadAccessPermissionIds(
  permissions: readonly string[] | null | undefined,
): string[] {
  return [
    ...new Set((permissions ?? []).map((id) => id.trim()).filter(Boolean)),
  ].sort((left, right) => left.localeCompare(right));
}

function normalizeStringList(
  values: readonly string[] | null | undefined,
): string[] {
  return [...new Set(values ?? [])].sort((left, right) =>
    left.localeCompare(right),
  );
}

export function projectLegacyThreadAccessBooleans(
  permissions: readonly string[],
): LegacyThreadAccessBooleans {
  const projection = { ...DEFAULT_THREAD_ACCESS_PROJECTION };
  const permissionSet = new Set(permissions);
  for (const [permission, key] of Object.entries(
    LEGACY_PERMISSION_ACCESS_KEYS,
  )) {
    projection[key] = permissionSet.has(permission);
  }
  projection.metidosAccess = projection.threadsAccess || projection.cronsAccess;
  projection.weatherAccess = false;
  return projection;
}

export function projectThreadAccessControl(
  input: ThreadAccessProjectionInput = {},
): ThreadAccessProjection {
  const permissions = Array.isArray(input.permissions)
    ? normalizeThreadAccessPermissionIds(input.permissions)
    : [...DEFAULT_THREAD_ACCESS_PERMISSION_IDS];
  return {
    ...projectLegacyThreadAccessBooleans(permissions),
    permissions,
    pluginAccessGroups: normalizeStringList(input.pluginAccessGroups),
  };
}

export function projectLegacyThreadAccessControl(
  input: ThreadAccessProjectionInput = {},
  options: LegacyThreadAccessProjectionOptions = {},
): ThreadAccessProjection {
  const defaultLegacyAccess = options.defaultLegacyAccess ?? false;
  const defaultMetidosAccess = input.metidosAccess ?? defaultLegacyAccess;
  const legacyBooleans: LegacyThreadAccessBooleans = {
    agentsAccess: input.agentsAccess ?? false,
    calendarAccess: input.calendarAccess ?? false,
    cronsAccess: input.cronsAccess ?? defaultMetidosAccess,
    gitAccess: input.gitAccess ?? false,
    githubAccess: input.githubAccess ?? false,
    metidosAccess: false,
    notificationsAccess: input.notificationsAccess ?? false,
    sqliteAccess: input.sqliteAccess ?? false,
    threadsAccess: input.threadsAccess ?? defaultMetidosAccess,
    unsafeMode: input.unsafeMode ?? false,
    webSearchAccess: input.webSearchAccess ?? defaultLegacyAccess,
    webServerAccess: input.webServerAccess ?? false,
    weatherAccess: input.weatherAccess ?? false,
  };
  legacyBooleans.metidosAccess =
    legacyBooleans.threadsAccess || legacyBooleans.cronsAccess;
  const permissions = Object.entries(LEGACY_THREAD_ACCESS_PERMISSION_IDS)
    .filter(([key]) => legacyBooleans[key as keyof LegacyThreadAccessBooleans])
    .map(([, permission]) => permission);
  return {
    ...legacyBooleans,
    permissions: normalizeThreadAccessPermissionIds(permissions),
    pluginAccessGroups: normalizeStringList(input.pluginAccessGroups),
  };
}

export function projectSafeChildThreadAccessControl(
  input: ThreadAccessProjectionInput,
): ThreadAccessProjection {
  return projectThreadAccessControl({
    ...input,
    permissions: normalizeThreadAccessPermissionIds(input.permissions).filter(
      (permission) => permission !== "metidos:unsafe",
    ),
  });
}
