/**
 * Build the websocket URL the browser should use when connecting directly to the RPC backend.
 * The host must match the page host so the session cookie is shared across ports.
 */
export function buildBrowserFacingRpcWebSocketUrl(options: {
  browserFacingHost: string | null;
  forwardedProto: "http" | "https";
  rpcPort: number;
}): string | null {
  if (!options.browserFacingHost) {
    return null;
  }

  const url = new URL(
    `${options.forwardedProto === "https" ? "wss" : "ws"}://${options.browserFacingHost}`,
  );
  url.port = String(options.rpcPort);
  url.pathname = "/rpc";
  url.search = "";
  url.hash = "";
  return url.toString();
}
