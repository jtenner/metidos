import { describe, expect, test } from "bun:test";
import { RpcRequestQueue } from "./rpc-request-queue";

describe("RpcRequestQueue", () => {
  test("limits active requests until permits are released", async () => {
    const queue = new RpcRequestQueue(1);
    const first = await queue.acquire("default", null);
    const second = queue.acquire("default", null);

    expect(queue.activeCount).toBe(1);
    expect(queue.queuedCount).toBe(1);

    first.release();
    const secondPermit = await second;

    expect(queue.activeCount).toBe(1);
    expect(queue.queuedCount).toBe(0);

    secondPermit.release();
    expect(queue.activeCount).toBe(0);
  });

  test("prioritizes foreground work over queued background work", async () => {
    const queue = new RpcRequestQueue(1);
    const active = await queue.acquire("default", null);
    const resolved: string[] = [];
    const background = queue.acquire("background", null).then((permit) => {
      resolved.push("background");
      return permit;
    });
    const foreground = queue.acquire("foreground", null).then((permit) => {
      resolved.push("foreground");
      return permit;
    });

    active.release();
    const foregroundPermit = await foreground;

    expect(resolved).toEqual(["foreground"]);
    expect(queue.activeCount).toBe(1);
    expect(queue.queuedCount).toBe(1);

    foregroundPermit.release();
    const backgroundPermit = await background;
    expect(resolved).toEqual(["foreground", "background"]);

    backgroundPermit.release();
  });

  test("removes aborted queued requests", async () => {
    const queue = new RpcRequestQueue(1);
    const active = await queue.acquire("default", null);
    const controller = new AbortController();
    const queued = queue.acquire("default", controller.signal);

    controller.abort();

    await expect(queued).rejects.toThrow("aborted");
    expect(queue.queuedCount).toBe(0);

    active.release();
    expect(queue.activeCount).toBe(0);
  });
});
