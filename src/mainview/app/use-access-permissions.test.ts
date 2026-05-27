/**
 * @file src/mainview/app/use-access-permissions.test.ts
 * @description Tests for Mainview access permission projection helpers.
 */

import { describe, expect, it } from "bun:test";

import type { RpcCronJob, RpcThread } from "../../bun/rpc-schema";
import type { ThreadAccessValue } from "../controls/thread-access-control";
import {
  accessPermissionsEqual,
  accessPermissionsFromCronJob,
  accessPermissionsFromThread,
  normalizeAccessPermissions,
} from "./use-access-permissions";

const BASE_ACCESS_VALUE: ThreadAccessValue = {
  agentsAccess: false,
  gitAccess: false,
  githubAccess: false,
  metidosAccess: false,
  sqliteAccess: false,
  unsafeMode: false,
  webSearchAccess: false,
};

describe("access permission projection helpers", () => {
  it("normalizes Mainview access state through canonical permission ids", () => {
    expect(
      normalizeAccessPermissions({
        ...BASE_ACCESS_VALUE,
        permissions: [
          "metidos:unsafe",
          "metidos:threads",
          "metidos:web-search",
          "metidos:threads",
          "provider:read",
        ],
        pluginAccessGroups: ["provider/read"],
        gitAccess: true,
      }),
    ).toMatchObject({
      permissions: [
        "metidos:threads",
        "metidos:unsafe",
        "metidos:web-search",
        "provider:read",
      ],
      pluginAccessGroups: ["provider/read"],
      threadsAccess: true,
      cronsAccess: false,
      metidosAccess: true,
      webSearchAccess: true,
      gitAccess: false,
      unsafeMode: true,
    });
  });

  it("derives selected thread access from canonical permissions", () => {
    const thread = {
      permissions: ["metidos:git"],
      pluginAccessGroups: ["provider/write"],
      webSearchAccess: true,
      gitAccess: false,
      metidosAccess: true,
      unsafeMode: true,
    } as RpcThread;

    expect(accessPermissionsFromThread(thread)).toMatchObject({
      permissions: ["metidos:git"],
      pluginAccessGroups: ["provider/write"],
      webSearchAccess: false,
      gitAccess: true,
      threadsAccess: false,
      cronsAccess: false,
      metidosAccess: false,
      unsafeMode: false,
    });
  });

  it("derives cron editor access from canonical permissions", () => {
    const cronJob = {
      permissions: ["metidos:crons", "metidos:web-search"],
      pluginAccessGroups: [],
      cronsAccess: false,
      metidosAccess: false,
      webSearchAccess: false,
    } as unknown as RpcCronJob;

    expect(accessPermissionsFromCronJob(cronJob)).toMatchObject({
      permissions: ["metidos:crons", "metidos:web-search"],
      cronsAccess: true,
      threadsAccess: false,
      metidosAccess: true,
      webSearchAccess: true,
    });
  });

  it("compares equivalent access values after canonical sorting and projection", () => {
    expect(
      accessPermissionsEqual(
        {
          ...BASE_ACCESS_VALUE,
          permissions: ["metidos:web-search", "metidos:threads"],
        },
        {
          ...BASE_ACCESS_VALUE,
          permissions: ["metidos:threads", "metidos:web-search"],
          metidosAccess: false,
        },
      ),
    ).toBe(true);
  });
});
