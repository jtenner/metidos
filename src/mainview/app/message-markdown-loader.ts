import { lazy } from "react";

type RichMarkdownModule = typeof import("./message-markdown");

export type RichMarkdownMessageProps = {
  text: string;
};

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
