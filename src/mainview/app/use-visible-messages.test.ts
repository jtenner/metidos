/**
 * @file src/mainview/app/use-visible-messages.test.ts
 * @description Focused tests for visible-message helper extraction.
 */

import { describe, expect, it } from "bun:test";

import type { RpcThreadMessage } from "../../bun/rpc-schema";
import { mergeThreadMessageHistory } from "./use-visible-messages";

function chatMessage(
  id: number,
  text: string,
  overrides?: Partial<RpcThreadMessage>,
): RpcThreadMessage {
  return {
    createdAt: `2026-04-12T16:18:${String(id).padStart(2, "0")}Z`,
    id,
    itemId: null,
    kind: "chat",
    role: "assistant",
    state: "completed",
    text,
    threadId: 7,
    updatedAt: `2026-04-12T16:18:${String(id).padStart(2, "0")}Z`,
    ...overrides,
  } as RpcThreadMessage;
}

describe("mergeThreadMessageHistory", () => {
  it("appends strictly newer ranges without reordering existing messages", () => {
    const current = [chatMessage(1, "alpha"), chatMessage(2, "beta")];
    const incoming = [chatMessage(3, "gamma"), chatMessage(4, "delta")];

    const merged = mergeThreadMessageHistory(current, incoming);

    expect(merged.map((message) => message.id)).toEqual([1, 2, 3, 4]);
    expect(merged[0]).toBe(current[0]);
    expect(merged[1]).toBe(current[1]);
    expect(merged[2]).toBe(incoming[0]);
    expect(merged[3]).toBe(incoming[1]);
  });

  it("deduplicates overlapping histories and keeps the newest copy for repeated ids", () => {
    const current = [chatMessage(1, "alpha"), chatMessage(3, "old gamma")];
    const incoming = [chatMessage(2, "beta"), chatMessage(3, "new gamma")];

    const merged = mergeThreadMessageHistory(current, incoming);

    expect(merged.map((message) => [message.id, message.text])).toEqual([
      [1, "alpha"],
      [2, "beta"],
      [3, "new gamma"],
    ]);
    expect(merged[2]).toBe(incoming[1]);
  });
});
