import { type DiffParseResult, parseUnifiedDiffText } from "./diff-parsing";

export type DiffParsingWorkerRequest = {
  diffText: string;
  id: number;
};

export type DiffParsingWorkerResponse =
  | {
      id: number;
      ok: true;
      result: DiffParseResult;
    }
  | {
      error: string;
      id: number;
      ok: false;
    };

type DiffParsingWorkerScope = {
  addEventListener: (
    type: "message",
    listener: (event: MessageEvent<DiffParsingWorkerRequest>) => void,
  ) => void;
  postMessage: (message: DiffParsingWorkerResponse) => void;
};

const workerScope = globalThis as unknown as DiffParsingWorkerScope;

workerScope.addEventListener(
  "message",
  (event: MessageEvent<DiffParsingWorkerRequest>) => {
    const { data } = event;

    try {
      workerScope.postMessage({
        id: data.id,
        ok: true,
        result: parseUnifiedDiffText(data.diffText),
      } satisfies DiffParsingWorkerResponse);
    } catch (error) {
      workerScope.postMessage({
        error: error instanceof Error ? error.message : "Failed to parse diff",
        id: data.id,
        ok: false,
      } satisfies DiffParsingWorkerResponse);
    }
  },
);
