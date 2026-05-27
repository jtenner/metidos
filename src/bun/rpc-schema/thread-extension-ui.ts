export type RpcThreadExtensionUiDialogMethod =
  | "confirm"
  | "editor"
  | "input"
  | "select";

export type RpcThreadExtensionUiRequest =
  | {
      threadId: number;
      requestId: string;
      method: "select";
      title: string;
      options: string[];
      timeoutMs?: number;
    }
  | {
      threadId: number;
      requestId: string;
      method: "confirm";
      title: string;
      message: string;
      timeoutMs?: number;
    }
  | {
      threadId: number;
      requestId: string;
      method: "input";
      title: string;
      placeholder?: string;
      timeoutMs?: number;
    }
  | {
      threadId: number;
      requestId: string;
      method: "editor";
      title: string;
      prefill?: string;
      timeoutMs?: number;
    }
  | {
      threadId: number;
      requestId: string;
      method: "notify";
      message: string;
      notifyType?: "info" | "warning" | "error";
    }
  | {
      threadId: number;
      requestId: string;
      method: "set_status";
      statusKey: string;
      statusText: string | null;
    }
  | {
      threadId: number;
      requestId: string;
      method: "set_widget";
      widgetKey: string;
      widgetLines: string[] | null;
      widgetPlacement?: "aboveEditor" | "belowEditor";
    }
  | {
      threadId: number;
      requestId: string;
      method: "set_title";
      title: string;
    }
  | {
      threadId: number;
      requestId: string;
      method: "set_editor_text";
      text: string;
    }
  | {
      threadId: number;
      requestId: string;
      method: "append_editor_text";
      text: string;
    }
  | {
      threadId: number;
      requestId: string;
      method: "set_working_message";
      message: string | null;
    }
  | {
      threadId: number;
      requestId: string;
      method: "set_working_visible";
      visible: boolean;
    }
  | {
      threadId: number;
      requestId: string;
      method: "set_hidden_thinking_label";
      label: string | null;
    }
  | {
      threadId: number;
      requestId: string;
      method: "dismiss_request";
    };

export type RpcThreadExtensionUiResponse =
  | {
      requestId: string;
      value: string;
    }
  | {
      requestId: string;
      confirmed: boolean;
    }
  | {
      requestId: string;
      cancelled: true;
    };

/**
 * Thread start request is also used as queued payload and runtime response details.
 */
