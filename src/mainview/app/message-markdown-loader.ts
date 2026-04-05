import { lazy } from "react";

type RichMarkdownModule = typeof import("./message-markdown");
type PreparedRichMarkdownMessageComponent =
  typeof import("./message-markdown").PreparedRichMarkdownMessage;

export type RichMarkdownMessageProps = {
  text: string;
};

export type PreparedRichMarkdownMessageProps =
  Parameters<PreparedRichMarkdownMessageComponent>[0];

let richMarkdownModulePromise: Promise<RichMarkdownModule> | null = null;

export function loadRichMarkdownModule(): Promise<RichMarkdownModule> {
  if (richMarkdownModulePromise) {
    return richMarkdownModulePromise;
  }

  richMarkdownModulePromise = import("./message-markdown");
  return richMarkdownModulePromise;
}

export const LazyRichMarkdownMessage = lazy(async () => {
  const module = await loadRichMarkdownModule();
  return {
    default: module.RichMarkdownMessage,
  };
});

export const LazyPreparedRichMarkdownMessage = lazy(async () => {
  const module = await loadRichMarkdownModule();
  return {
    default: module.PreparedRichMarkdownMessage,
  };
});
