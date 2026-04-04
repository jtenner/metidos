import { describe, expect, it } from "bun:test";

import {
  createSupersedingSecurityAuditRefreshRunner,
  type SecurityAuditRefreshRequest,
} from "./security-audit-refresh";

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve = () => {};
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve;
  });
  return {
    promise,
    resolve,
  };
}

function deferredValue<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve = (_value: T) => {};
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return {
    promise,
    resolve,
  };
}

describe("security audit refresh helpers", () => {
  it("runs only the latest queued refresh after the current request settles", async () => {
    const startedScopes: Array<{
      projectId: number | null;
      threadId: number | null;
    }> = [];
    const blockers: Array<ReturnType<typeof deferred>> = [];
    const secondStarted = deferred();
    const runner = createSupersedingSecurityAuditRefreshRunner({
      load: async ({ options }) => {
        startedScopes.push(options);
        if (startedScopes.length === 2) {
          secondStarted.resolve();
        }
        const gate = deferred();
        blockers.push(gate);
        await gate.promise;
      },
    });

    const firstRequest = runner.request();
    await Promise.resolve();

    void runner.request({
      projectId: 7,
    });
    void runner.request({
      threadId: 11,
    });

    expect(startedScopes).toEqual([
      {
        projectId: null,
        threadId: null,
      },
    ]);

    blockers[0]?.resolve();
    await secondStarted.promise;

    expect(startedScopes).toEqual([
      {
        projectId: null,
        threadId: null,
      },
      {
        projectId: null,
        threadId: 11,
      },
    ]);

    blockers[1]?.resolve();
    await firstRequest;
  });

  it("marks an in-flight refresh as stale once a newer request is queued", async () => {
    const firstGate = deferred();
    const firstRequestDeferred = deferredValue<SecurityAuditRefreshRequest>();
    const secondRequestDeferred = deferredValue<SecurityAuditRefreshRequest>();
    const runner = createSupersedingSecurityAuditRefreshRunner({
      load: async (request) => {
        if (request.requestId === 1) {
          firstRequestDeferred.resolve(request);
          await firstGate.promise;
          return;
        }
        secondRequestDeferred.resolve(request);
      },
    });

    const firstRun = runner.request();
    const capturedFirstRequest = await firstRequestDeferred.promise;
    expect(capturedFirstRequest.isLatestRequest()).toBeTrue();

    void runner.request({
      projectId: 3,
    });

    expect(capturedFirstRequest.isLatestRequest()).toBeFalse();

    firstGate.resolve();
    await firstRun;

    const capturedSecondRequest = await secondRequestDeferred.promise;
    expect(capturedSecondRequest.isLatestRequest()).toBeTrue();
    expect(capturedSecondRequest.options).toEqual({
      projectId: 3,
      threadId: null,
    });
  });

  it("does not rerun the same scope when it is requested again while already loading", async () => {
    const firstGate = deferred();
    const firstRequestDeferred = deferredValue<SecurityAuditRefreshRequest>();
    let calls = 0;
    const runner = createSupersedingSecurityAuditRefreshRunner({
      load: async (request) => {
        calls += 1;
        if (calls === 1) {
          firstRequestDeferred.resolve(request);
          await firstGate.promise;
        }
      },
    });

    const firstRun = runner.request({
      projectId: 5,
    });
    await Promise.resolve();

    void runner.request({
      projectId: 5,
    });

    const capturedFirstRequest = await firstRequestDeferred.promise;
    expect(capturedFirstRequest.isLatestRequest()).toBeTrue();

    firstGate.resolve();
    await firstRun;

    expect(calls).toBe(1);
  });
});
