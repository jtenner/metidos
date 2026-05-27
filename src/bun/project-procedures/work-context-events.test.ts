import { describe, expect, it } from "bun:test";

import { workContextEvents } from "./work-context-events";

describe("workContextEvents", () => {
  it("constructs and publishes Work Context lifecycle events through one focused module", () => {
    const events = [
      workContextEvents.cronListChanged(),
      workContextEvents.threadDetailInvalidated(42),
      workContextEvents.threadStatusChanged({ id: 42 } as never),
      workContextEvents.contextFocusChanged("session-7", {
        projectId: 9,
        projectName: "Repo",
        projectPath: "/repo",
        threadId: 42,
        worktreePath: "/repo",
      }),
      workContextEvents.worktreeGitHistoryChanged(9, "/repo"),
    ];

    const published: string[] = [];
    for (const event of events) {
      workContextEvents.publish((publishedEvent) => {
        published.push(publishedEvent.type);
      }, event);
    }

    expect(published).toEqual([
      "cron-list-changed",
      "thread-detail-invalidated",
      "thread-status-changed",
      "context-focus-changed",
      "worktree-git-history-changed",
    ]);
    expect(events[3]).toMatchObject({
      payload: { projectId: 9, threadId: 42, worktreePath: "/repo" },
      sessionId: "session-7",
    });
  });
});
