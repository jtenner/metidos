import { expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PI_RUNTIME_PROBE_RPC_API_KEY,
  PI_RUNTIME_PROBE_RUNTIME_API_KEY,
  runPiBunSdkProbe,
  runPiRpcProbe,
} from "./pi-runtime-probe";

setDefaultTimeout(15_000);

test("Pi Bun SDK probe covers streaming, provider auth, abort, and resume", async () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), "metidos-pi-bun-sdk-probe-"));

  try {
    const result = await runPiBunSdkProbe(workspaceDir);

    expect(result.runtime).toBe("bun-sdk");
    expect(result.apiKeySeen).toBe(PI_RUNTIME_PROBE_RUNTIME_API_KEY);
    expect(result.authorizationHeaderSeen).toBe(
      `Bearer ${PI_RUNTIME_PROBE_RUNTIME_API_KEY}`,
    );
    expect(result.streamedText).toContain(
      `apiKey=${PI_RUNTIME_PROBE_RUNTIME_API_KEY}`,
    );
    expect(result.streamedText).toContain(`provider=metidos-pi-probe`);
    expect(result.sessionFile).toBeString();
    expect(result.resumedSessionId).toBe(result.sessionId);
    expect(result.resumedMessageCount).toBeGreaterThanOrEqual(2);
    expect(result.abortStopReason).toBe("aborted");
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test("Pi Node RPC fallback probe covers streaming, provider auth, and abort", async () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), "metidos-pi-rpc-probe-"));

  try {
    const result = await runPiRpcProbe(workspaceDir);

    expect(result.runtime).toBe("node-rpc");
    expect(result.apiKeySeen).toBe(PI_RUNTIME_PROBE_RPC_API_KEY);
    expect(result.authorizationHeaderSeen).toBe(
      `Bearer ${PI_RUNTIME_PROBE_RPC_API_KEY}`,
    );
    expect(result.streamedText).toContain(
      `apiKey=${PI_RUNTIME_PROBE_RPC_API_KEY}`,
    );
    expect(result.streamedText).toContain(`provider=metidos-pi-probe`);
    expect(result.abortStopReason).toBe("aborted");
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});
