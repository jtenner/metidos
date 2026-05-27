export type RpcTerminalStatus =
  | "starting"
  | "running"
  | "closing"
  | "exited"
  | "error";

export type RpcTerminal = {
  command: string | null;
  cols: number;
  createdAt: string;
  createdFromThreadId: number | null;
  cwd: string;
  exitCode: number | null;
  exitSignal: string | null;
  projectId: number;
  projectName: string;
  rows: number;
  status: RpcTerminalStatus;
  terminalId: string;
  terminalIndex: number;
  title: string;
  updatedAt: string;
  worktreeFolder: string;
  worktreePath: string;
};

export type RpcTerminalSettings = {
  defaultShell: string;
  replayBufferBytes: number;
};

export type RpcCreateTerminalRequest = {
  projectId: number;
  worktreePath: string;
  cols?: number;
  command?: string | null;
  createdFromThreadId?: number | null;
  cwd?: string | null;
  dir?: string | null;
  rows?: number;
  title?: string | null;
};

export type RpcCreateTerminalResult = {
  terminal: RpcTerminal;
  connection: RpcTerminalConnectionInfo;
};

export type RpcTerminalConnectionInfo = {
  terminalId: string;
  webSocketPath: string;
};

/**
 * Model/ranking data used by thread creation and UI selectors.
 */
