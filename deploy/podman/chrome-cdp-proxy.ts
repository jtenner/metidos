const publicPort = Number(process.env.METIDOS_CHROME_DEBUG_PORT || "9222");
const backendPort = Number(
  process.env.METIDOS_CHROME_DEBUG_BACKEND_PORT || "19222",
);
const backendBase = `http://127.0.0.1:${backendPort}`;

if (!Number.isInteger(publicPort) || publicPort <= 0) {
  throw new Error(
    `Invalid METIDOS_CHROME_DEBUG_PORT: ${process.env.METIDOS_CHROME_DEBUG_PORT}`,
  );
}

if (!Number.isInteger(backendPort) || backendPort <= 0) {
  throw new Error(
    `Invalid METIDOS_CHROME_DEBUG_BACKEND_PORT: ${process.env.METIDOS_CHROME_DEBUG_BACKEND_PORT}`,
  );
}

type CdpProxyData = {
  backend?: WebSocket;
  backendOpen: boolean;
  queue: Array<string | ArrayBufferView | ArrayBuffer>;
  target: string;
};

function rewriteDevtoolsHost(text: string, host: string): string {
  return text
    .replaceAll(`127.0.0.1:${backendPort}`, host)
    .replaceAll(`localhost:${backendPort}`, host);
}

function buildBackendUrl(request: Request): URL {
  const url = new URL(request.url);
  return new URL(`${url.pathname}${url.search}`, backendBase);
}

Bun.serve<CdpProxyData>({
  hostname: "0.0.0.0",
  port: publicPort,
  async fetch(request, server) {
    const backendUrl = buildBackendUrl(request);

    if (
      server.upgrade(request, {
        data: { backendOpen: false, queue: [], target: backendUrl.href },
      })
    ) {
      return undefined;
    }

    let response: Response;
    try {
      response = await fetch(backendUrl, {
        body: request.body,
        headers: request.headers,
        method: request.method,
      });
    } catch (error) {
      return new Response(
        `Chrome DevTools backend is not reachable: ${String(error)}\n`,
        {
          status: 502,
        },
      );
    }
    const headers = new Headers(response.headers);
    headers.delete("content-length");

    const contentType = headers.get("content-type") || "";
    if (contentType.includes("json") || contentType.startsWith("text/")) {
      const host = request.headers.get("host") || `127.0.0.1:${publicPort}`;
      const text = rewriteDevtoolsHost(await response.text(), host);
      return new Response(text, {
        headers,
        status: response.status,
        statusText: response.statusText,
      });
    }

    return new Response(response.body, {
      headers,
      status: response.status,
      statusText: response.statusText,
    });
  },
  websocket: {
    open(client) {
      const backendUrl = new URL(client.data.target);
      backendUrl.protocol = "ws:";
      const backend = new WebSocket(backendUrl.href);
      client.data.backend = backend;

      backend.addEventListener("open", () => {
        client.data.backendOpen = true;
        for (const message of client.data.queue.splice(0)) {
          backend.send(message);
        }
      });

      backend.addEventListener("message", (event) => {
        client.send(event.data);
      });

      backend.addEventListener("close", (event) => {
        client.close(event.code, event.reason);
      });

      backend.addEventListener("error", () => {
        client.close(1011, "Chrome DevTools backend error");
      });
    },
    message(client, message) {
      const backend = client.data.backend;
      if (!backend || !client.data.backendOpen) {
        client.data.queue.push(message);
        return;
      }
      backend.send(message);
    },
    close(client) {
      client.data.backend?.close();
    },
  },
});

console.log(
  `Chrome DevTools proxy listening on 0.0.0.0:${publicPort}, forwarding to 127.0.0.1:${backendPort}`,
);
