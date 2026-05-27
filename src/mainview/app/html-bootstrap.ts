import {
  type AppRPCSchema,
  MAINVIEW_HTML_BOOTSTRAP_CONTRACT,
} from "../../bun/rpc-schema";

export type MainviewHtmlBootstrapPayload = {
  schema: typeof MAINVIEW_HTML_BOOTSTRAP_CONTRACT.schema;
  createdAt: string;
  staleAfterMs: number;
  data: AppRPCSchema["requests"]["getAppBootstrap"]["response"];
};

const BOOTSTRAP_ELEMENT_ID = "metidos-mainview-bootstrap";

export function getMainviewHtmlBootstrapElementId(): string {
  return BOOTSTRAP_ELEMENT_ID;
}

function hasDocument(): boolean {
  return typeof document !== "undefined";
}

export function readMainviewHtmlBootstrapPayload(): MainviewHtmlBootstrapPayload | null {
  if (!hasDocument()) {
    return null;
  }

  const element = document.getElementById(BOOTSTRAP_ELEMENT_ID);
  if (element === null || element.textContent === null) {
    return null;
  }

  try {
    const payload = JSON.parse(
      element.textContent,
    ) as Partial<MainviewHtmlBootstrapPayload>;
    if (
      payload.schema !== MAINVIEW_HTML_BOOTSTRAP_CONTRACT.schema ||
      typeof payload.createdAt !== "string" ||
      typeof payload.staleAfterMs !== "number" ||
      payload.data === null ||
      typeof payload.data !== "object"
    ) {
      return null;
    }
    return payload as MainviewHtmlBootstrapPayload;
  } catch {
    return null;
  }
}

export function consumeMainviewHtmlBootstrapPayload(): MainviewHtmlBootstrapPayload | null {
  const payload = readMainviewHtmlBootstrapPayload();
  if (hasDocument()) {
    document.getElementById(BOOTSTRAP_ELEMENT_ID)?.remove();
  }
  return payload;
}

export function isMainviewHtmlBootstrapStale(
  payload: MainviewHtmlBootstrapPayload,
  nowMs = Date.now(),
): boolean {
  const createdAtMs = Date.parse(payload.createdAt);
  if (!Number.isFinite(createdAtMs)) {
    return true;
  }
  return nowMs - createdAtMs > payload.staleAfterMs;
}
