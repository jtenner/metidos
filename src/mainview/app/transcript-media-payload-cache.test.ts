import { describe, expect, it } from "bun:test";
import {
  mergeTranscriptMediaPayloadData,
  writeTranscriptMediaPayloads,
} from "./transcript-media-payload-cache";

function payload(byteLength: number): string {
  return "a".repeat(Math.ceil((byteLength * 4) / 3));
}

describe("transcript media payload cache", () => {
  it("evicts oldest previously loaded payloads when the byte budget is exceeded", () => {
    const current = new Map<string, { byteSize: number; data: string }>([
      ["first", { byteSize: 8, data: payload(8) }],
    ]);
    const incoming = new Map([
      ["second", payload(8)],
      ["third", payload(8)],
    ]);

    const cache = writeTranscriptMediaPayloads(current, incoming, {
      maxBytes: 16,
      maxEntries: 64,
    });

    expect([...cache.keys()]).toEqual(["second", "third"]);
  });

  it("keeps an incoming payload batch together even when it exceeds the byte budget", () => {
    const cache = writeTranscriptMediaPayloads(
      new Map([["old", { byteSize: 8, data: payload(8) }]]),
      new Map([
        ["first", payload(8)],
        ["second", payload(8)],
        ["third", payload(8)],
      ]),
      { maxBytes: 16, maxEntries: 64 },
    );

    expect([...cache.keys()]).toEqual(["first", "second", "third"]);
  });

  it("evicts oldest payloads when the entry budget is exceeded", () => {
    const cache = writeTranscriptMediaPayloads(
      new Map(),
      new Map([
        ["first", payload(1)],
        ["second", payload(1)],
        ["third", payload(1)],
      ]),
      { maxBytes: 1024, maxEntries: 2 },
    );

    expect([...cache.keys()]).toEqual(["second", "third"]);
  });

  it("merges visible payloads with loaded cache payload data", () => {
    const merged = mergeTranscriptMediaPayloadData(
      new Map([["visible", "visible-data"]]),
      new Map([["loaded", { byteSize: 4, data: "loaded-data" }]]),
    );

    expect([...merged.entries()]).toEqual([
      ["visible", "visible-data"],
      ["loaded", "loaded-data"],
    ]);
  });
});
