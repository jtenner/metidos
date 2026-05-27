/**
 * @file src/mainview/rpc-websocket-send.ts
 * @description Helpers for classifying browser/Bun WebSocket send outcomes.
 */

export type ClientWebSocketSendOutcome = "backpressure" | "dropped" | "sent";

export function classifyClientWebSocketSendStatus(
  sendStatus: unknown,
): ClientWebSocketSendOutcome {
  if (sendStatus === -1) {
    return "backpressure";
  }
  if (sendStatus === 0) {
    return "dropped";
  }
  return "sent";
}

export function assertClientWebSocketSendSucceeded(sendStatus: unknown): void {
  const sendOutcome = classifyClientWebSocketSendStatus(sendStatus);
  if (sendOutcome !== "sent") {
    throw new Error(`RPC websocket send ${sendOutcome}.`);
  }
}
