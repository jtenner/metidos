import {
  type PreparedMessageRenderPlan,
  prepareMessageRenderPlan,
} from "./message-preprocessing";

export type MessagePreprocessingWorkerRequest = {
  id: number;
  text: string;
};

export type MessagePreprocessingWorkerResponse =
  | {
      id: number;
      ok: true;
      plan: PreparedMessageRenderPlan;
    }
  | {
      error: string;
      id: number;
      ok: false;
    };

type MessagePreprocessingWorkerScope = {
  addEventListener: (
    type: "message",
    listener: (event: MessageEvent<MessagePreprocessingWorkerRequest>) => void,
  ) => void;
  postMessage: (message: MessagePreprocessingWorkerResponse) => void;
};

const workerScope = globalThis as unknown as MessagePreprocessingWorkerScope;

workerScope.addEventListener("message", (event) => {
  const { data } = event;

  try {
    workerScope.postMessage({
      id: data.id,
      ok: true,
      plan: prepareMessageRenderPlan(data.text),
    });
  } catch (error) {
    workerScope.postMessage({
      error:
        error instanceof Error ? error.message : "Failed to preprocess message",
      id: data.id,
      ok: false,
    });
  }
});
