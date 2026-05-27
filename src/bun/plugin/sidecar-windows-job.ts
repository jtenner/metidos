/**
 * @file src/bun/plugin/sidecar-windows-job.ts
 * @description Windows Job Object wrapper for Plugin System v1 sidecar processes.
 */

const TEXT_ENCODER = new TextEncoder();

function positiveInteger(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

type ChildInputSink =
  | WritableStream<Uint8Array>
  | {
      end?: () => unknown;
      flush?: () => unknown;
      write: (chunk: Uint8Array) => unknown;
    };

async function pipeReadableToWritable(
  readable: ReadableStream<Uint8Array> | null,
  writable: ChildInputSink | null,
): Promise<void> {
  if (!readable || !writable) {
    return;
  }
  const reader = readable.getReader();
  if ("getWriter" in writable) {
    const writer = writable.getWriter();
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) {
          break;
        }
        await writer.write(chunk.value);
      }
    } finally {
      reader.releaseLock();
      await writer.close().catch(() => undefined);
    }
    return;
  }
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      await writable.write(chunk.value);
      await writable.flush?.();
    }
  } finally {
    reader.releaseLock();
    await Promise.resolve(writable.end?.()).catch(() => undefined);
  }
}

async function writeReadableToStdout(
  readable: ReadableStream<Uint8Array> | null,
): Promise<void> {
  if (!readable) {
    return;
  }
  const reader = readable.getReader();
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      process.stdout.write(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
}

async function writeReadableToStderr(
  readable: ReadableStream<Uint8Array> | null,
): Promise<void> {
  if (!readable) {
    return;
  }
  const reader = readable.getReader();
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      process.stderr.write(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
}

function wideString(value: string): Uint16Array {
  const buffer = new Uint16Array(value.length + 1);
  for (let index = 0; index < value.length; index += 1) {
    buffer[index] = value.charCodeAt(index);
  }
  return buffer;
}

type WindowsJobHandles = {
  close: () => void;
};

async function assignWindowsJobObject(input: {
  memoryLimitBytes: number;
  processId: number;
}): Promise<WindowsJobHandles> {
  if (process.platform !== "win32") {
    return { close: () => {} };
  }
  const ffi = await import("bun:ffi");
  const { FFIType, dlopen, ptr } = ffi;
  const kernel32 = dlopen("kernel32.dll", {
    AssignProcessToJobObject: {
      args: [FFIType.ptr, FFIType.ptr],
      returns: FFIType.bool,
    },
    CloseHandle: { args: [FFIType.ptr], returns: FFIType.bool },
    CreateJobObjectW: {
      args: [FFIType.ptr, FFIType.ptr],
      returns: FFIType.ptr,
    },
    GetLastError: { args: [], returns: FFIType.u32 },
    OpenProcess: {
      args: [FFIType.u32, FFIType.bool, FFIType.u32],
      returns: FFIType.ptr,
    },
    SetInformationJobObject: {
      args: [FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.u32],
      returns: FFIType.bool,
    },
  });

  const PROCESS_SET_QUOTA = 0x0100;
  const PROCESS_TERMINATE = 0x0001;
  const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
  const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION = 9;
  const JOB_OBJECT_LIMIT_PROCESS_MEMORY = 0x00000100;
  const JOB_OBJECT_LIMIT_JOB_MEMORY = 0x00000200;
  const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;

  const jobName = wideString(
    `MetidosPluginSidecar-${process.pid}-${input.processId}`,
  );
  const jobHandle = kernel32.symbols.CreateJobObjectW(null, ptr(jobName));
  if (!jobHandle) {
    throw new Error(
      `CreateJobObjectW failed: ${kernel32.symbols.GetLastError()}`,
    );
  }

  const info = new ArrayBuffer(144);
  const view = new DataView(info);
  view.setUint32(
    16,
    JOB_OBJECT_LIMIT_PROCESS_MEMORY |
      JOB_OBJECT_LIMIT_JOB_MEMORY |
      JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    true,
  );
  view.setBigUint64(112, BigInt(input.memoryLimitBytes), true);
  view.setBigUint64(120, BigInt(input.memoryLimitBytes), true);

  const setOk = kernel32.symbols.SetInformationJobObject(
    jobHandle,
    JOB_OBJECT_EXTENDED_LIMIT_INFORMATION,
    ptr(info),
    info.byteLength,
  );
  if (!setOk) {
    const error = kernel32.symbols.GetLastError();
    kernel32.symbols.CloseHandle(jobHandle);
    throw new Error(`SetInformationJobObject failed: ${error}`);
  }

  const processHandle = kernel32.symbols.OpenProcess(
    PROCESS_SET_QUOTA | PROCESS_TERMINATE | PROCESS_QUERY_LIMITED_INFORMATION,
    false,
    input.processId,
  );
  if (!processHandle) {
    const error = kernel32.symbols.GetLastError();
    kernel32.symbols.CloseHandle(jobHandle);
    throw new Error(`OpenProcess failed: ${error}`);
  }
  const assignOk = kernel32.symbols.AssignProcessToJobObject(
    jobHandle,
    processHandle,
  );
  kernel32.symbols.CloseHandle(processHandle);
  if (!assignOk) {
    const error = kernel32.symbols.GetLastError();
    kernel32.symbols.CloseHandle(jobHandle);
    throw new Error(`AssignProcessToJobObject failed: ${error}`);
  }

  return {
    close: () => {
      kernel32.symbols.CloseHandle(jobHandle);
    },
  };
}

async function main(): Promise<void> {
  const separatorIndex = process.argv.indexOf("--");
  if (separatorIndex === -1) {
    throw new Error("Expected -- before the sidecar command.");
  }
  const memoryLimitBytes = positiveInteger(
    process.env.METIDOS_PLUGIN_SIDECAR_MEMORY_LIMIT_BYTES,
  );
  if (!memoryLimitBytes) {
    throw new Error("METIDOS_PLUGIN_SIDECAR_MEMORY_LIMIT_BYTES is required.");
  }
  const command = process.argv.slice(separatorIndex + 1);
  if (command.length === 0) {
    throw new Error("Sidecar command is required.");
  }

  const child = Bun.spawn({
    cmd: command,
    env: process.env,
    stderr: "pipe",
    stdin: "pipe",
    stdout: "pipe",
  });
  if (!child.pid) {
    child.kill();
    throw new Error("Sidecar process did not expose a pid.");
  }

  let job: WindowsJobHandles | null = null;
  try {
    job = await assignWindowsJobObject({
      memoryLimitBytes,
      processId: child.pid,
    });
  } catch (error) {
    child.kill();
    throw error;
  }

  await Promise.all([
    pipeReadableToWritable(Bun.stdin.stream(), child.stdin),
    writeReadableToStdout(child.stdout),
    writeReadableToStderr(child.stderr),
    child.exited,
  ]).finally(() => {
    job?.close();
  });
  process.exit(await child.exited);
}

if (import.meta.main) {
  void main().catch((error) => {
    process.stderr.write(
      TEXT_ENCODER.encode(
        `Plugin Windows job wrapper failed: ${
          error instanceof Error ? error.message : String(error)
        }\n`,
      ),
    );
    process.exit(1);
  });
}
