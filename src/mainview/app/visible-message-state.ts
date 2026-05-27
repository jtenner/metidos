/**
 * @file src/mainview/app/visible-message-state.ts
 * @description Thread transcript Message state rendered by Mainview.
 */

type VisibleMessageBase = {
  key: string;
};

export type VisibleChatImageAttachment = {
  type: "image";
  payloadKey: string;
  mimeType: string;
  byteSize: number;
  dataLoaded?: boolean | undefined;
  previewByteSize?: number | undefined;
  previewMimeType?: string | undefined;
};

export type VisibleMediaPayloads = ReadonlyMap<string, string>;

export type VisibleMessage =
  | (VisibleMessageBase & {
      kind: "chat";
      messageId?: number;
      speaker: "assistant" | "user";
      state?: "in_progress" | "completed" | "stopped";
      text: string;
      images?: VisibleChatImageAttachment[];
      tone?: "normal" | "working" | "error" | "notice";
    })
  | (VisibleMessageBase & {
      kind: "reasoning";
      text: string;
      state: "in_progress" | "completed" | "stopped";
    })
  | (VisibleMessageBase & {
      kind: "command";
      messageId: number;
      command: string;
      output: string;
      outputLoaded: boolean;
      state: "in_progress" | "completed" | "failed" | "stopped";
      exitCode: number | null;
    })
  | (VisibleMessageBase & {
      kind: "file_change";
      messageId: number;
      path: string;
      diffText: string;
      diffLoaded: boolean;
      changeKind: "add" | "delete" | "update";
      state: "in_progress" | "completed" | "failed" | "stopped";
    })
  | (VisibleMessageBase & {
      kind: "tool_call";
      messageId: number;
      server: string;
      tool: string;
      argumentsText: string;
      output: string;
      outputLoaded: boolean;
      outputImages?: VisibleChatImageAttachment[];
      state: "in_progress" | "completed" | "failed" | "stopped";
    })
  | (VisibleMessageBase & {
      kind: "web_search";
      query: string;
      state: "in_progress" | "completed" | "stopped";
    })
  | (VisibleMessageBase & {
      kind: "error";
      text: string;
      state: "in_progress" | "completed" | "stopped";
    });

/**
 * Grouped conversation rows used by the thread message list.
 */
export type MessageGroup =
  | {
      kind: "assistant";
      key: string;
      messages: VisibleMessage[];
    }
  | {
      kind: "user";
      key: string;
      text: string;
    };
