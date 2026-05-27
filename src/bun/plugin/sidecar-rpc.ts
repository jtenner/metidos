/**
 * @file src/bun/plugin/sidecar-rpc.ts
 * @description Typed JSON-over-stdio protocol schema helpers for Metidos plugin sidecars.
 */

export const PLUGIN_SIDECAR_RPC_PROTOCOL_VERSION = 1;
// Protocol decision: Plugin sidecars use newline-delimited JSON frames with
// an 8 MiB decoded-frame cap. We are not adding length prefixes/checksums for
// v1 because the sidecar boundary is a local worker/subprocess pipe, frames are
// validated before dispatch, and the byte cap bounds malformed-frame memory.
export const PLUGIN_SIDECAR_RPC_MAX_PAYLOAD_BYTES = 8 * 1024 * 1024;
export const PLUGIN_SIDECAR_RPC_MAX_PAYLOAD_LABEL = "8 MB";

const TEXT_ENCODER = new TextEncoder();
const ENVELOPE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const PLUGIN_ID_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;
const REQUEST_OPERATION_PATTERN = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)*$/;
const ENV_KEY_PATTERN = /^[A-Z_][A-Z0-9_]*$/;

export type PluginSidecarEnvelopeType =
  | "host.cancel"
  | "host.error"
  | "host.request"
  | "host.response"
  | "host.shutdown"
  | "host.startup"
  | "sidecar.error"
  | "sidecar.event"
  | "sidecar.ready"
  | "sidecar.request"
  | "sidecar.response";

export type PluginSidecarProtocolErrorCode =
  | "invalid_json"
  | "invalid_payload"
  | "invalid_protocol_frame"
  | "invalid_protocol_version"
  | "malformed_envelope"
  | "oversized_payload"
  | "unknown_envelope_type"
  | "wrong_plugin";

export type PluginSidecarProtocolError = {
  code: PluginSidecarProtocolErrorCode;
  message: string;
  pluginId?: string | undefined;
  requestId?: string | undefined;
};

export type PluginSidecarEnvelopeBase<
  TType extends PluginSidecarEnvelopeType,
  TPayload,
> = {
  id: string;
  payload: TPayload;
  pluginId: string;
  type: TType;
};

export type PluginSidecarStartupEnvVar = {
  key: string;
  required: boolean;
  secret: boolean;
  value: string | null;
};

export type PluginSidecarStartupSettingValue =
  | boolean
  | number
  | string
  | string[]
  | null;

export type PluginSidecarStartupSettingsPayload = {
  missingRequiredKeys: string[];
  values: Record<string, PluginSidecarStartupSettingValue>;
};

export type PluginSidecarStartupNetworkPayload = {
  allow: string[];
  enforceHttps: boolean | null;
  webSocketAllow?: string[];
};

export type PluginSidecarStartupFsPayload = {
  files: {
    allow: {
      delete: string[];
      read: string[];
      write: string[];
    };
    deny: {
      delete: string[];
      read: string[];
      write: string[];
    };
  };
  pluginPath: string;
  quota: {
    maxDataBytes: number;
    maxFileBytes: number;
    maxFiles: number;
  };
};

export type PluginSidecarStartupPayload = {
  apiVersion: "v1";
  env: PluginSidecarStartupEnvVar[];
  fs?: PluginSidecarStartupFsPayload;
  network?: PluginSidecarStartupNetworkPayload | null;
  permissions?: string[];
  protocolVersion: typeof PLUGIN_SIDECAR_RPC_PROTOCOL_VERSION;
  reviewHash: string;
  unsafeAllowPrivateNetwork?: boolean;
  settings?: PluginSidecarStartupSettingsPayload;
};

export type PluginSidecarRequestPayload = {
  deadlineMs?: number;
  hostRequestId?: string;
  operation: string;
  params?: unknown;
};

export type PluginSidecarCancellationPayload = {
  reason?: string;
  targetId: string;
};

export type PluginSidecarShutdownPayload = {
  graceMs?: number;
  reason: "host_shutdown" | "plugin_disabled" | "plugin_retry" | "plugin_reset";
};

export type PluginSidecarReadyPayload = {
  protocolVersion: typeof PLUGIN_SIDECAR_RPC_PROTOCOL_VERSION;
  registrations?: unknown;
};

export type PluginSidecarResponsePayload = {
  requestId: string;
  result: unknown;
};

export type PluginSidecarErrorPayload = {
  code: string;
  message: string;
  requestId?: string;
  retryable?: boolean;
  unavailable?: boolean;
};

export type PluginSidecarEventPayload = {
  event: string;
  value?: unknown;
};

export type PluginSidecarHostResponsePayload = PluginSidecarResponsePayload;
export type PluginSidecarHostErrorPayload = PluginSidecarErrorPayload;

export type PluginSidecarStartupEnvelope = PluginSidecarEnvelopeBase<
  "host.startup",
  PluginSidecarStartupPayload
>;
export type PluginSidecarRequestEnvelope = PluginSidecarEnvelopeBase<
  "host.request",
  PluginSidecarRequestPayload
>;
export type PluginSidecarCancellationEnvelope = PluginSidecarEnvelopeBase<
  "host.cancel",
  PluginSidecarCancellationPayload
>;
export type PluginSidecarShutdownEnvelope = PluginSidecarEnvelopeBase<
  "host.shutdown",
  PluginSidecarShutdownPayload
>;
export type PluginSidecarHostResponseEnvelope = PluginSidecarEnvelopeBase<
  "host.response",
  PluginSidecarHostResponsePayload
>;
export type PluginSidecarHostErrorEnvelope = PluginSidecarEnvelopeBase<
  "host.error",
  PluginSidecarHostErrorPayload
>;
export type PluginSidecarReadyEnvelope = PluginSidecarEnvelopeBase<
  "sidecar.ready",
  PluginSidecarReadyPayload
>;
export type PluginSidecarResponseEnvelope = PluginSidecarEnvelopeBase<
  "sidecar.response",
  PluginSidecarResponsePayload
>;
export type PluginSidecarErrorEnvelope = PluginSidecarEnvelopeBase<
  "sidecar.error",
  PluginSidecarErrorPayload
>;
export type PluginSidecarEventEnvelope = PluginSidecarEnvelopeBase<
  "sidecar.event",
  PluginSidecarEventPayload
>;
export type PluginSidecarHostRequestEnvelope = PluginSidecarEnvelopeBase<
  "sidecar.request",
  PluginSidecarRequestPayload
>;

export type PluginSidecarHostEnvelope =
  | PluginSidecarCancellationEnvelope
  | PluginSidecarHostErrorEnvelope
  | PluginSidecarHostResponseEnvelope
  | PluginSidecarRequestEnvelope
  | PluginSidecarShutdownEnvelope
  | PluginSidecarStartupEnvelope;

export type PluginSidecarInboundEnvelope =
  | PluginSidecarErrorEnvelope
  | PluginSidecarEventEnvelope
  | PluginSidecarHostRequestEnvelope
  | PluginSidecarReadyEnvelope
  | PluginSidecarResponseEnvelope;

export type PluginSidecarEnvelope =
  | PluginSidecarHostEnvelope
  | PluginSidecarInboundEnvelope;

export type PluginSidecarDecodeSuccess = {
  envelope: PluginSidecarEnvelope;
  ok: true;
};

export type PluginSidecarDecodeFailure = {
  error: PluginSidecarProtocolError;
  ok: false;
};

export type PluginSidecarDecodeResult =
  | PluginSidecarDecodeFailure
  | PluginSidecarDecodeSuccess;

const KNOWN_ENVELOPE_TYPES = new Set<PluginSidecarEnvelopeType>([
  "host.cancel",
  "host.error",
  "host.request",
  "host.response",
  "host.shutdown",
  "host.startup",
  "sidecar.error",
  "sidecar.event",
  "sidecar.ready",
  "sidecar.request",
  "sidecar.response",
]);

function byteLength(value: string): number {
  return TEXT_ENCODER.encode(value).byteLength;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEnvelopeType(value: unknown): value is PluginSidecarEnvelopeType {
  return (
    typeof value === "string" &&
    (KNOWN_ENVELOPE_TYPES as ReadonlySet<string>).has(value)
  );
}

function failure(
  code: PluginSidecarProtocolErrorCode,
  message: string,
  extra: Omit<PluginSidecarProtocolError, "code" | "message"> = {},
): PluginSidecarDecodeFailure {
  return {
    error: {
      code,
      message,
      ...extra,
    },
    ok: false,
  };
}

function validateEnvelopeIdentity(
  envelope: Record<string, unknown>,
  expectedPluginId?: string,
): PluginSidecarDecodeFailure | null {
  if (
    typeof envelope.id !== "string" ||
    !ENVELOPE_ID_PATTERN.test(envelope.id)
  ) {
    return failure(
      "malformed_envelope",
      "Plugin sidecar protocol envelope id must be a non-empty string up to 128 characters.",
    );
  }

  if (
    typeof envelope.pluginId !== "string" ||
    !PLUGIN_ID_PATTERN.test(envelope.pluginId)
  ) {
    return failure(
      "malformed_envelope",
      "Plugin sidecar protocol envelope pluginId must be a valid plugin id.",
      { requestId: envelope.id },
    );
  }

  if (
    expectedPluginId !== undefined &&
    envelope.pluginId !== expectedPluginId
  ) {
    return failure(
      "wrong_plugin",
      "Plugin sidecar protocol envelope pluginId did not match the expected plugin.",
      { pluginId: envelope.pluginId, requestId: envelope.id },
    );
  }

  return null;
}

function validateCommonPayload(
  envelope: Record<string, unknown>,
): PluginSidecarDecodeFailure | null {
  if (!isRecord(envelope.payload)) {
    return failure(
      "invalid_payload",
      "Plugin sidecar protocol envelope payload must be an object.",
      {
        pluginId:
          typeof envelope.pluginId === "string" ? envelope.pluginId : undefined,
        requestId: typeof envelope.id === "string" ? envelope.id : undefined,
      },
    );
  }

  return null;
}

function validateStartupEnvPayload(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        isRecord(item) &&
        typeof item.key === "string" &&
        ENV_KEY_PATTERN.test(item.key) &&
        typeof item.required === "boolean" &&
        typeof item.secret === "boolean" &&
        (typeof item.value === "string" || item.value === null),
    )
  );
}

function validateStartupSettingValue(value: unknown): boolean {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value)) ||
    (Array.isArray(value) && value.every((item) => typeof item === "string"))
  );
}

function validateStartupSettingsPayload(value: unknown): boolean {
  return (
    value === undefined ||
    (isRecord(value) &&
      isRecord(value.values) &&
      Object.values(value.values).every(validateStartupSettingValue) &&
      Array.isArray(value.missingRequiredKeys) &&
      value.missingRequiredKeys.every(
        (key) => typeof key === "string" && key.length > 0,
      ))
  );
}

function validateStartupPermissionsPayload(value: unknown): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) && value.every((item) => typeof item === "string"))
  );
}

function validateStartupNetworkPayload(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (isRecord(value) &&
      Array.isArray(value.allow) &&
      value.allow.every((item) => typeof item === "string") &&
      (typeof value.enforceHttps === "boolean" || value.enforceHttps === null))
  );
}

function validateStartupPayload(
  envelope: PluginSidecarEnvelope,
): PluginSidecarDecodeFailure | null {
  if (envelope.type !== "host.startup") {
    return null;
  }

  const payload = envelope.payload;
  if (
    payload.apiVersion !== "v1" ||
    payload.protocolVersion !== PLUGIN_SIDECAR_RPC_PROTOCOL_VERSION ||
    typeof payload.reviewHash !== "string" ||
    payload.reviewHash.length === 0 ||
    !validateStartupEnvPayload(payload.env) ||
    !validateStartupNetworkPayload(payload.network) ||
    !validateStartupPermissionsPayload(payload.permissions) ||
    !validateStartupSettingsPayload(payload.settings) ||
    (payload.unsafeAllowPrivateNetwork !== undefined &&
      typeof payload.unsafeAllowPrivateNetwork !== "boolean")
  ) {
    return failure(
      payload.protocolVersion !== PLUGIN_SIDECAR_RPC_PROTOCOL_VERSION
        ? "invalid_protocol_version"
        : "invalid_payload",
      "Plugin sidecar startup payload is invalid.",
      { pluginId: envelope.pluginId, requestId: envelope.id },
    );
  }

  return null;
}

function validateRequestPayload(
  envelope: PluginSidecarEnvelope,
): PluginSidecarDecodeFailure | null {
  if (envelope.type !== "host.request" && envelope.type !== "sidecar.request") {
    return null;
  }

  const payload = envelope.payload;
  if (
    typeof payload.operation !== "string" ||
    !REQUEST_OPERATION_PATTERN.test(payload.operation)
  ) {
    return failure(
      "invalid_payload",
      "Plugin sidecar request operation is invalid.",
      {
        pluginId: envelope.pluginId,
        requestId: envelope.id,
      },
    );
  }

  if (
    payload.deadlineMs !== undefined &&
    (!Number.isFinite(payload.deadlineMs) || payload.deadlineMs <= 0)
  ) {
    return failure(
      "invalid_payload",
      "Plugin sidecar request deadline is invalid.",
      {
        pluginId: envelope.pluginId,
        requestId: envelope.id,
      },
    );
  }

  if (
    payload.hostRequestId !== undefined &&
    (typeof payload.hostRequestId !== "string" ||
      !ENVELOPE_ID_PATTERN.test(payload.hostRequestId))
  ) {
    return failure(
      "invalid_payload",
      "Plugin sidecar request host request id is invalid.",
      {
        pluginId: envelope.pluginId,
        requestId: envelope.id,
      },
    );
  }

  return null;
}

function validateCancellationPayload(
  envelope: PluginSidecarEnvelope,
): PluginSidecarDecodeFailure | null {
  if (envelope.type !== "host.cancel") {
    return null;
  }

  const payload = envelope.payload;
  if (
    typeof payload.targetId !== "string" ||
    !ENVELOPE_ID_PATTERN.test(payload.targetId)
  ) {
    return failure(
      "invalid_payload",
      "Plugin sidecar cancellation target is invalid.",
      {
        pluginId: envelope.pluginId,
        requestId: envelope.id,
      },
    );
  }

  return null;
}

function validateShutdownPayload(
  envelope: PluginSidecarEnvelope,
): PluginSidecarDecodeFailure | null {
  if (envelope.type !== "host.shutdown") {
    return null;
  }

  const payload = envelope.payload;
  if (
    ![
      "host_shutdown",
      "plugin_disabled",
      "plugin_retry",
      "plugin_reset",
    ].includes(payload.reason)
  ) {
    return failure(
      "invalid_payload",
      "Plugin sidecar shutdown reason is invalid.",
      {
        pluginId: envelope.pluginId,
        requestId: envelope.id,
      },
    );
  }

  if (
    payload.graceMs !== undefined &&
    (!Number.isFinite(payload.graceMs) || payload.graceMs < 0)
  ) {
    return failure(
      "invalid_payload",
      "Plugin sidecar shutdown graceMs is invalid.",
      {
        pluginId: envelope.pluginId,
        requestId: envelope.id,
      },
    );
  }

  return null;
}

function validateReadyPayload(
  envelope: PluginSidecarEnvelope,
): PluginSidecarDecodeFailure | null {
  if (envelope.type !== "sidecar.ready") {
    return null;
  }

  if (
    envelope.payload.protocolVersion !== PLUGIN_SIDECAR_RPC_PROTOCOL_VERSION
  ) {
    return failure(
      "invalid_protocol_version",
      "Plugin sidecar ready protocol version is invalid.",
      {
        pluginId: envelope.pluginId,
        requestId: envelope.id,
      },
    );
  }

  return null;
}

function validateCorrelatedPayload(
  envelope: PluginSidecarEnvelope,
): PluginSidecarDecodeFailure | null {
  if (
    envelope.type !== "sidecar.response" &&
    envelope.type !== "sidecar.error" &&
    envelope.type !== "host.response" &&
    envelope.type !== "host.error"
  ) {
    return null;
  }

  const requestId = envelope.payload.requestId;
  if (requestId !== undefined && !ENVELOPE_ID_PATTERN.test(requestId)) {
    return failure(
      "invalid_payload",
      "Plugin sidecar correlated request id is invalid.",
      {
        pluginId: envelope.pluginId,
        requestId: envelope.id,
      },
    );
  }

  if (envelope.type === "sidecar.error" || envelope.type === "host.error") {
    if (
      typeof envelope.payload.code !== "string" ||
      envelope.payload.code.length === 0 ||
      typeof envelope.payload.message !== "string" ||
      envelope.payload.message.length === 0
    ) {
      return failure(
        "invalid_payload",
        "Plugin sidecar error payload is invalid.",
        {
          pluginId: envelope.pluginId,
          requestId: envelope.id,
        },
      );
    }
    return null;
  }

  if (typeof requestId !== "string") {
    return failure(
      "invalid_payload",
      "Plugin sidecar response requestId is required.",
      {
        pluginId: envelope.pluginId,
        requestId: envelope.id,
      },
    );
  }

  return null;
}

function validateEventPayload(
  envelope: PluginSidecarEnvelope,
): PluginSidecarDecodeFailure | null {
  if (envelope.type !== "sidecar.event") {
    return null;
  }

  if (
    typeof envelope.payload.event !== "string" ||
    envelope.payload.event.length === 0
  ) {
    return failure(
      "invalid_payload",
      "Plugin sidecar event payload is invalid.",
      {
        pluginId: envelope.pluginId,
        requestId: envelope.id,
      },
    );
  }

  return null;
}

function validateTypedPayload(
  envelope: PluginSidecarEnvelope,
): PluginSidecarDecodeFailure | null {
  return (
    validateStartupPayload(envelope) ??
    validateRequestPayload(envelope) ??
    validateCancellationPayload(envelope) ??
    validateShutdownPayload(envelope) ??
    validateReadyPayload(envelope) ??
    validateCorrelatedPayload(envelope) ??
    validateEventPayload(envelope)
  );
}

export function decodePluginSidecarRpcEnvelope(
  frame: string,
  options: { expectedPluginId?: string } = {},
): PluginSidecarDecodeResult {
  const trimmedFrame = frame.trimEnd();
  if (trimmedFrame.length === 0 || trimmedFrame.includes("\n")) {
    return failure(
      "invalid_protocol_frame",
      "Plugin sidecar stdout must contain exactly one complete newline-delimited JSON frame.",
    );
  }

  if (byteLength(trimmedFrame) > PLUGIN_SIDECAR_RPC_MAX_PAYLOAD_BYTES) {
    return failure(
      "oversized_payload",
      `Plugin sidecar protocol frame exceeds the ${PLUGIN_SIDECAR_RPC_MAX_PAYLOAD_LABEL} payload limit.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmedFrame);
  } catch {
    return failure(
      "invalid_json",
      "Plugin sidecar protocol frame must be valid JSON.",
    );
  }

  if (!isRecord(parsed)) {
    return failure(
      "malformed_envelope",
      "Plugin sidecar protocol frame must be a JSON object.",
    );
  }

  if (!isEnvelopeType(parsed.type)) {
    return failure(
      typeof parsed.type === "string"
        ? "unknown_envelope_type"
        : "malformed_envelope",
      "Plugin sidecar protocol envelope type is unknown or missing.",
      {
        requestId: typeof parsed.id === "string" ? parsed.id : undefined,
      },
    );
  }

  const identityFailure = validateEnvelopeIdentity(
    parsed,
    options.expectedPluginId,
  );
  if (identityFailure) {
    return identityFailure;
  }

  const payloadFailure = validateCommonPayload(parsed);
  if (payloadFailure) {
    return payloadFailure;
  }

  const envelope = parsed as PluginSidecarEnvelope;
  const typedFailure = validateTypedPayload(envelope);
  if (typedFailure) {
    return typedFailure;
  }

  return { envelope, ok: true };
}

export function encodePluginSidecarRpcEnvelope(
  envelope: PluginSidecarEnvelope,
): string | PluginSidecarDecodeFailure {
  const serialized = JSON.stringify(envelope);
  if (byteLength(serialized) > PLUGIN_SIDECAR_RPC_MAX_PAYLOAD_BYTES) {
    return failure(
      "oversized_payload",
      `Plugin sidecar protocol frame exceeds the ${PLUGIN_SIDECAR_RPC_MAX_PAYLOAD_LABEL} payload limit.`,
      { pluginId: envelope.pluginId, requestId: envelope.id },
    );
  }

  const validation = decodePluginSidecarRpcEnvelope(serialized, {
    expectedPluginId: envelope.pluginId,
  });
  if (!validation.ok) {
    return validation;
  }

  return `${serialized}\n`;
}
