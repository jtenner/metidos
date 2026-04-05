/**
 * @file src/mainview/project-lifecycle.test.ts
 * @description Test file for project lifecycle.
 */

import { describe, expect, it } from "bun:test";

import { createProjectLifecycleRequestTracker } from "./project-lifecycle";

describe("project lifecycle request tracker", () => {
  it("invalidates an earlier expand request and worktree refresh when the project is closed", () => {
    const tracker = createProjectLifecycleRequestTracker();

    const openRequest = tracker.begin(7);
    const worktreeRefresh = tracker.snapshot(7);

    expect(openRequest.isCurrent()).toBeTrue();
    expect(worktreeRefresh.isCurrent()).toBeTrue();

    const closeRequest = tracker.begin(7);

    expect(openRequest.isCurrent()).toBeFalse();
    expect(worktreeRefresh.isCurrent()).toBeFalse();
    expect(closeRequest.isCurrent()).toBeTrue();
  });

  it("invalidates a close request once a later reopen begins", () => {
    const tracker = createProjectLifecycleRequestTracker();

    tracker.begin(3);
    const closeRequest = tracker.begin(3);

    expect(closeRequest.isCurrent()).toBeTrue();

    const reopenRequest = tracker.begin(3);

    expect(closeRequest.isCurrent()).toBeFalse();
    expect(reopenRequest.isCurrent()).toBeTrue();
  });

  it("keeps lifecycle requests isolated per project", () => {
    const tracker = createProjectLifecycleRequestTracker();

    const projectOneRequest = tracker.begin(1);
    const projectTwoRequest = tracker.begin(2);
    tracker.begin(1);

    expect(projectOneRequest.isCurrent()).toBeFalse();
    expect(projectTwoRequest.isCurrent()).toBeTrue();
  });
});
