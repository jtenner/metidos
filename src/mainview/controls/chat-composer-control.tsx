/**
 * @file src/mainview/controls/chat-composer-control.tsx
 * @description Module for chat composer control.
 */

import {
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type JSX,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type ChatImageDraftAttachment,
  formatBytes,
  isChatImageByteSizeAllowed,
  isSupportedChatImageMimeType,
  MAX_CHAT_IMAGE_ATTACHMENTS,
  normalizeChatImageMimeType,
} from "../../shared/chat-images";
import { useBase64ObjectUrl } from "../app/base64-object-url";
import {
  APP_TITLE,
  DESKTOP_COMPOSER_MIN_HEIGHT_PX,
  MOBILE_COMPOSER_MIN_HEIGHT_PX,
} from "../app/mainview-ui-state";
import { devLog } from "../dev-log";
import { mergeClassNames } from "../dynamic-styles";
import { AppButton } from "./button";
import { ListRowButton } from "./list-row";
import {
  getTextareaCaretViewportPosition,
  resizeComposerTextarea,
} from "./chat-composer-autosize";
import {
  setChatComposerDraft,
  useChatComposerDraft,
} from "./chat-composer-draft-store";
import {
  readChatComposerImageAttachments,
  startChatComposerImageAttachmentRead,
  finishChatComposerImageAttachmentRead,
  setChatComposerImageAttachments,
  useChatComposerImageAttachments,
  useChatComposerPendingImageAttachmentReads,
} from "./chat-composer-image-attachments";
import {
  filterChatComposerSkills,
  matchChatComposerSkillsTrigger,
} from "./chat-composer-skills";
import { materialSymbol } from "./icons";
import { createPointReference, PopoverSurface } from "./popover";

type ChatComposerControlProps = {
  actionDisabled: boolean;
  actionLabel: string;
  availableSkills?: string[] | undefined;
  disabled: boolean;
  draftKey?: string | null;
  fillHeight?: boolean;
  hasSelectedThread: boolean;
  initialValue: string;
  isWorking: boolean;
  onDraftChange?: ((value: string) => void) | undefined;
  onSubmitMessage: () => void;
  supportsImageInput: boolean;
  variant: "desktop" | "mobile";
};

/**
 * Stable accessible label for the chat composer textarea.
 */
export function chatComposerTextareaLabel(hasSelectedThread: boolean): string {
  return hasSelectedThread
    ? `Message ${APP_TITLE}`
    : `Draft message for ${APP_TITLE} (create a thread to send)`;
}

export function createImageAttachmentId(): string {
  return `image-${crypto.randomUUID()}`;
}

export function fileNameLooksLikeChatImage(fileName: string): boolean {
  return /\.(gif|jpe?g|png|webp)$/iu.test(fileName.trim());
}

function ChatComposerImageAttachmentPreview({
  image,
  index,
  onRemove,
}: {
  image: ChatImageDraftAttachment;
  index: number;
  onRemove: () => void;
}): JSX.Element {
  const imageSource = useBase64ObjectUrl(image.data, image.mimeType);

  return (
    <div className="flex max-w-full items-center gap-2 border border-border-default bg-surface-2 px-2 py-1 text-xs text-text-secondary">
      {imageSource ? (
        <img
          alt=""
          className="h-8 w-8 border border-border-subtle object-cover"
          src={imageSource}
        />
      ) : null}
      <span className="min-w-0 truncate">
        Image {index + 1} · {formatBytes(image.byteSize)}
      </span>
      <AppButton
        aria-label={`Remove image ${index + 1}`}
        buttonStyle="muted"
        className="h-7 w-7 min-w-0 border-transparent bg-transparent"
        iconOnly
        onClick={onRemove}
      >
        {materialSymbol("close", "text-[15px]")}
      </AppButton>
    </div>
  );
}

export function fileLooksLikeChatImage(
  file: Pick<File, "name" | "type">,
): boolean {
  return (
    file.type.startsWith("image/") ||
    (file.type.trim() === "" && fileNameLooksLikeChatImage(file.name)) ||
    fileNameLooksLikeChatImage(file.name)
  );
}

function logChatImageComposerEvent(
  event: string,
  details?: Record<string, unknown>,
): void {
  devLog("chat images", event, details ?? {});
}

function warnChatImageComposerEvent(
  event: string,
  details?: Record<string, unknown>,
): void {
  devLog("chat images warning", event, details ?? {});
}

function readImageFileAsAttachment(
  file: File,
): Promise<ChatImageDraftAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => {
      warnChatImageComposerEvent("FileReader failed", {
        name: file.name,
        size: file.size,
        type: file.type,
      });
      reject(new Error("Failed to read image."));
    };
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const [, data = ""] = result.split(",", 2);
      if (!data) {
        warnChatImageComposerEvent("FileReader returned empty image data", {
          name: file.name,
          size: file.size,
          type: file.type,
        });
        reject(new Error("Failed to read image."));
        return;
      }
      const imageTypeResult = normalizeChatImageMimeType(data, file.type);
      if ("error" in imageTypeResult) {
        warnChatImageComposerEvent("Image MIME validation failed after read", {
          error: imageTypeResult.error,
          name: file.name,
          size: file.size,
          type: file.type,
        });
        reject(new Error(imageTypeResult.error));
        return;
      }
      resolve({
        byteSize: file.size,
        data,
        id: createImageAttachmentId(),
        mimeType: imageTypeResult.mimeType,
        type: "image",
      });
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Chat input control used in both desktop and mobile sidebars.
 * Applies variant-specific layout and submit keyboard behavior.
 */
export function ChatComposerControl({
  actionDisabled,
  actionLabel,
  availableSkills,
  disabled,
  draftKey,
  fillHeight = false,
  hasSelectedThread,
  initialValue,
  isWorking,
  onDraftChange,
  onSubmitMessage,
  supportsImageInput,
  variant,
}: ChatComposerControlProps): JSX.Element {
  /**
   * Shared draft state for desktop and mobile variants.
   */
  const draft = useChatComposerDraft(initialValue, draftKey);
  const imageAttachments = useChatComposerImageAttachments(draftKey);
  const pendingImageAttachmentReads =
    useChatComposerPendingImageAttachmentReads(draftKey);
  const imageFileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const minHeightPx =
    variant === "desktop"
      ? DESKTOP_COMPOSER_MIN_HEIGHT_PX
      : MOBILE_COMPOSER_MIN_HEIGHT_PX;
  const placeholder = hasSelectedThread
    ? variant === "desktop"
      ? `Ask ${APP_TITLE} to generate, refactor, or debug...`
      : `Ask ${APP_TITLE}...`
    : variant === "desktop"
      ? `Create a thread to start chatting with ${APP_TITLE}...`
      : `Create a thread to chat with ${APP_TITLE}...`;
  const composerAriaLabel = chatComposerTextareaLabel(hasSelectedThread);
  const isReadingImageAttachments = pendingImageAttachmentReads > 0;

  const [skillsPopoverOpen, setSkillsPopoverOpen] = useState(false);
  const [activeSkillIndex, setActiveSkillIndex] = useState(0);
  const [pasteError, setPasteError] = useState("");
  const [caretSelectionVersion, setCaretSelectionVersion] = useState(0);
  const [caretReference, setCaretReference] = useState<ReturnType<
    typeof createPointReference
  > | null>(null);
  const skillsPopoverOpenRef = useRef(false);
  const activeSkillIndexRef = useRef(0);
  const suppressSkillsAutocompleteRef = useRef(false);
  const applySkillRafIdRef = useRef<number | null>(null);
  const currentDraftKeyRef = useRef<string | null | undefined>(draftKey);
  const mountedRef = useRef(true);
  const caretReferenceRectRef = useRef<{
    height: number;
    width: number;
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    currentDraftKeyRef.current = draftKey;
  }, [draftKey]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (applySkillRafIdRef.current !== null) {
        window.cancelAnimationFrame(applySkillRafIdRef.current);
        applySkillRafIdRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    void draftKey;
    setPasteError("");
  }, [draftKey]);

  useEffect(() => {
    skillsPopoverOpenRef.current = skillsPopoverOpen;
  }, [skillsPopoverOpen]);

  useEffect(() => {
    activeSkillIndexRef.current = activeSkillIndex;
  }, [activeSkillIndex]);

  const skillsMatch = useMemo(() => {
    void caretSelectionVersion;
    const textarea = textareaRef.current;
    if (!textarea || !availableSkills || availableSkills.length === 0) {
      return null;
    }
    return matchChatComposerSkillsTrigger(
      draft,
      textarea.selectionStart,
      availableSkills,
    );
  }, [draft, availableSkills, caretSelectionVersion]);

  const filteredSkills = useMemo(() => {
    return filterChatComposerSkills(availableSkills, skillsMatch);
  }, [skillsMatch, availableSkills]);

  useEffect(() => {
    if (suppressSkillsAutocompleteRef.current) {
      setSkillsPopoverOpen(false);
      return;
    }

    if (filteredSkills.length > 0 && skillsMatch) {
      const textarea = textareaRef.current;
      if (textarea) {
        const pos = getTextareaCaretViewportPosition(textarea);
        const nextRect = {
          height: 0,
          width: 0,
          x: pos.x,
          y: pos.y + pos.height,
        };
        const previousRect = caretReferenceRectRef.current;
        if (
          !previousRect ||
          previousRect.x !== nextRect.x ||
          previousRect.y !== nextRect.y ||
          previousRect.width !== nextRect.width ||
          previousRect.height !== nextRect.height
        ) {
          caretReferenceRectRef.current = nextRect;
          setCaretReference(
            createPointReference({
              contextElement: textarea,
              ...nextRect,
            }),
          );
        }
        if (!skillsPopoverOpenRef.current) {
          setSkillsPopoverOpen(true);
        }
        setActiveSkillIndex((prev) =>
          prev < filteredSkills.length
            ? prev
            : Math.max(0, filteredSkills.length - 1),
        );
      }
    } else {
      caretReferenceRectRef.current = null;
      setCaretReference(null);
      setSkillsPopoverOpen(false);
    }
  }, [filteredSkills.length, skillsMatch]);

  const applySkill = useCallback(
    (skillName: string) => {
      const textarea = textareaRef.current;
      if (!textarea || !skillsMatch) {
        return;
      }

      const before = draft.slice(0, skillsMatch.startIndex);
      const after = draft.slice(skillsMatch.endIndex);
      const trailingSeparator = " ";
      const nextValue = `${before}/skills:${skillName}${trailingSeparator}${after}`;

      suppressSkillsAutocompleteRef.current = true;
      setChatComposerDraft(nextValue, draftKey);
      onDraftChange?.(nextValue);
      setSkillsPopoverOpen(false);

      // Restore cursor after the inserted skill token and trailing separator.
      const cursorPos =
        skillsMatch.startIndex +
        `/skills:${skillName}${trailingSeparator}`.length;
      if (applySkillRafIdRef.current !== null) {
        window.cancelAnimationFrame(applySkillRafIdRef.current);
      }
      applySkillRafIdRef.current = window.requestAnimationFrame(() => {
        applySkillRafIdRef.current = null;
        if (mountedRef.current && currentDraftKeyRef.current === draftKey) {
          textarea.selectionStart = cursorPos;
          textarea.selectionEnd = cursorPos;
          textarea.focus();
          setCaretSelectionVersion((version) => version + 1);
        }
        suppressSkillsAutocompleteRef.current = false;
      });
    },
    [draft, draftKey, onDraftChange, skillsMatch],
  );

  const onChatInputChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      const nextValue = event.currentTarget.value;
      setChatComposerDraft(nextValue, draftKey);
      onDraftChange?.(nextValue);
    },
    [draftKey, onDraftChange],
  );

  const refreshSkillsAutocompleteForCaret = useCallback((): void => {
    setCaretSelectionVersion((version) => version + 1);
  }, []);

  const removeImageAttachment = useCallback(
    (imageId: string): void => {
      setPasteError("");
      setChatComposerImageAttachments(
        readChatComposerImageAttachments(draftKey).filter(
          (image) => image.id !== imageId,
        ),
        draftKey,
      );
    },
    [draftKey],
  );

  const appendImageFiles = useCallback(
    (candidateFiles: readonly File[]): void => {
      const files = candidateFiles.filter(fileLooksLikeChatImage);
      logChatImageComposerEvent("appendImageFiles called", {
        candidateCount: candidateFiles.length,
        imageLikeCount: files.length,
        supportsImageInput,
      });
      if (files.length === 0) {
        return;
      }
      if (!supportsImageInput) {
        warnChatImageComposerEvent(
          "Rejected images because model lacks image input support",
          {
            imageLikeCount: files.length,
          },
        );
        setPasteError("Current model does not support images.");
        return;
      }

      const currentAttachments = readChatComposerImageAttachments(draftKey);
      const availableSlots =
        MAX_CHAT_IMAGE_ATTACHMENTS - currentAttachments.length;
      if (availableSlots <= 0) {
        warnChatImageComposerEvent(
          "Rejected images because composer is at attachment limit",
          {
            currentAttachmentCount: currentAttachments.length,
            maxAttachments: MAX_CHAT_IMAGE_ATTACHMENTS,
          },
        );
        setPasteError(
          `A message can include at most ${MAX_CHAT_IMAGE_ATTACHMENTS} images.`,
        );
        return;
      }

      const acceptedFiles: File[] = [];
      for (const file of files) {
        if (acceptedFiles.length >= availableSlots) {
          break;
        }
        if (
          file.type.trim() !== "" &&
          !isSupportedChatImageMimeType(file.type) &&
          !fileNameLooksLikeChatImage(file.name)
        ) {
          warnChatImageComposerEvent(
            "Rejected image because MIME type is unsupported",
            {
              name: file.name,
              size: file.size,
              type: file.type,
            },
          );
          setPasteError("Only PNG, JPEG, GIF, and WebP images are supported.");
          continue;
        }
        if (!isChatImageByteSizeAllowed(file.size)) {
          warnChatImageComposerEvent(
            "Rejected image because it exceeds byte limit",
            {
              name: file.name,
              size: file.size,
              type: file.type,
            },
          );
          setPasteError("Images must be 10 MB or smaller.");
          continue;
        }
        acceptedFiles.push(file);
      }

      if (acceptedFiles.length === 0) {
        warnChatImageComposerEvent("No accepted image files after validation", {
          imageLikeCount: files.length,
        });
        return;
      }

      logChatImageComposerEvent("Reading accepted image files", {
        acceptedCount: acceptedFiles.length,
        acceptedFiles: acceptedFiles.map((file) => ({
          name: file.name,
          size: file.size,
          type: file.type,
        })),
      });
      setPasteError("");
      const readDraftKey = draftKey;
      startChatComposerImageAttachmentRead(readDraftKey);
      void Promise.all(acceptedFiles.map(readImageFileAsAttachment))
        .then((attachments) => {
          if (
            !mountedRef.current ||
            currentDraftKeyRef.current !== readDraftKey
          ) {
            return;
          }
          const nextAttachments = [
            ...readChatComposerImageAttachments(readDraftKey),
            ...attachments,
          ].slice(0, MAX_CHAT_IMAGE_ATTACHMENTS);
          logChatImageComposerEvent("Stored image attachments in composer", {
            addedCount: attachments.length,
            nextAttachmentCount: nextAttachments.length,
            nextAttachments: nextAttachments.map((attachment) => ({
              byteSize: attachment.byteSize,
              id: attachment.id,
              mimeType: attachment.mimeType,
              type: attachment.type,
            })),
          });
          setChatComposerImageAttachments(nextAttachments, readDraftKey);
        })
        .catch((error) => {
          warnChatImageComposerEvent("Failed to read/store image attachment", {
            error: error instanceof Error ? error.message : String(error),
          });
          if (
            !mountedRef.current ||
            currentDraftKeyRef.current !== readDraftKey
          ) {
            return;
          }
          setPasteError(error instanceof Error ? error.message : String(error));
        })
        .finally(() => {
          logChatImageComposerEvent("Finished image attachment read", {
            draftKey: readDraftKey ?? null,
          });
          finishChatComposerImageAttachmentRead(readDraftKey);
        });
    },
    [draftKey, supportsImageInput],
  );

  const onPaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>): void => {
      const clipboardItems = Array.from(event.clipboardData.items);
      const pastedFiles =
        clipboardItems.length > 0
          ? clipboardItems
              .filter((item) => item.kind === "file")
              .map((item) => item.getAsFile())
              .filter((file): file is File => file !== null)
          : Array.from(event.clipboardData.files);
      const files = pastedFiles.filter(fileLooksLikeChatImage);
      if (files.length === 0) {
        return;
      }

      event.preventDefault();
      appendImageFiles(files);
    },
    [appendImageFiles],
  );

  const onSelectImageFiles = useCallback((): void => {
    imageFileInputRef.current?.click();
  }, []);

  const onImageFileInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>): void => {
      const selectedFiles = Array.from(event.currentTarget.files ?? []);
      appendImageFiles(selectedFiles);
      event.currentTarget.value = "";
    },
    [appendImageFiles],
  );

  const onImageFileDragOver = useCallback(
    (event: DragEvent<HTMLElement>): void => {
      const droppedFiles = Array.from(event.dataTransfer.files).filter(
        fileLooksLikeChatImage,
      );
      if (droppedFiles.length === 0) {
        return;
      }
      // Only prevent the browser's default drop behavior for image-like files;
      // plain text/file drags should keep their native textarea behavior.
      event.preventDefault();
      event.dataTransfer.dropEffect = disabled ? "none" : "copy";
    },
    [disabled],
  );

  const onImageFileDrop = useCallback(
    (event: DragEvent<HTMLElement>): void => {
      const droppedFiles = Array.from(event.dataTransfer.files).filter(
        fileLooksLikeChatImage,
      );
      if (droppedFiles.length === 0) {
        return;
      }
      event.preventDefault();
      if (disabled) {
        return;
      }
      appendImageFiles(droppedFiles);
    },
    [appendImageFiles, disabled],
  );

  const onEnter = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key !== "Enter" || event.nativeEvent.isComposing) {
        return;
      }

      if (skillsPopoverOpenRef.current && filteredSkills.length > 0) {
        event.preventDefault();
        const skill = filteredSkills[activeSkillIndexRef.current];
        if (skill) {
          applySkill(skill);
        }
        return;
      }

      if (event.metaKey || event.ctrlKey) {
        event.preventDefault();
        if (!event.shiftKey && !event.altKey) {
          onSubmitMessage();
        }
      }
    },
    [filteredSkills, applySkill, onSubmitMessage],
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (!skillsPopoverOpenRef.current || filteredSkills.length === 0) {
        return;
      }

      switch (event.key) {
        case "ArrowDown": {
          event.preventDefault();
          setActiveSkillIndex((prev) =>
            prev < filteredSkills.length - 1 ? prev + 1 : 0,
          );
          break;
        }
        case "ArrowUp": {
          event.preventDefault();
          setActiveSkillIndex((prev) =>
            prev > 0 ? prev - 1 : filteredSkills.length - 1,
          );
          break;
        }
        case "Escape": {
          event.preventDefault();
          setSkillsPopoverOpen(false);
          break;
        }
      }
    },
    [filteredSkills.length],
  );

  const onComposerKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      onKeyDown(event);
      onEnter(event);
    },
    [onEnter, onKeyDown],
  );

  useEffect(() => {
    // Only resize when the DOM value is already aligned with controlled draft state.
    // During transitional updates, skipping prevents cursor jumps and intermediate measurements.
    const textarea = textareaRef.current;
    if (textarea && textarea.value !== draft) {
      return;
    }
    if (fillHeight && textarea) {
      textarea.style.height = "";
      return;
    }
    resizeComposerTextarea(textareaRef.current, minHeightPx);
  }, [draft, fillHeight, minHeightPx]);

  const imageAttachmentPreview =
    imageAttachments.length > 0 ? (
      <fieldset className="flex flex-wrap items-center gap-2">
        <legend className="sr-only">Image attachments</legend>
        {imageAttachments.map((image, index) => (
          <ChatComposerImageAttachmentPreview
            image={image}
            index={index}
            key={image.id}
            onRemove={() => {
              removeImageAttachment(image.id);
            }}
          />
        ))}
      </fieldset>
    ) : null;

  const pasteErrorMessage = pasteError ? (
    <div className="text-xs text-danger-text" role="alert">
      {pasteError}
    </div>
  ) : null;

  const imageLoadingMessage = isReadingImageAttachments ? (
    <div className="text-xs text-text-muted" role="status">
      Preparing image attachment…
    </div>
  ) : null;

  const imageFilePicker = (
    <input
      accept="image/png,image/jpeg,image/jpg,image/gif,image/webp"
      aria-label="Attach image files"
      className="sr-only"
      multiple
      onChange={onImageFileInputChange}
      ref={imageFileInputRef}
      type="file"
    />
  );

  const skillsPopover = (
    // The skills menu is intentionally a plain popover: textarea arrow/enter
    // handlers own its active option, so moving DOM focus into the suggestions
    // would interrupt normal typing and cursor behavior.
    <PopoverSurface
      className="z-50 min-w-[12rem] border border-border-default bg-surface-2 shadow-overlay"
      closeOnEscape={false}
      closeOnOutsidePress
      hideWhenEscaped={false}
      offsetPx={4}
      onRequestClose={() => {
        setSkillsPopoverOpen(false);
      }}
      open={skillsPopoverOpen && filteredSkills.length > 0}
      placement="bottom-start"
      reference={caretReference}
      surfaceMode="plain"
    >
      <div className="flex max-h-48 flex-col overflow-y-auto">
        {filteredSkills.map((skill, index) => {
          const active = index === activeSkillIndex;
          return (
            <ListRowButton
              active={active}
              key={skill}
              className="flex items-center text-sm"
              onClick={() => {
                applySkill(skill);
              }}
              onMouseEnter={() => {
                setActiveSkillIndex(index);
              }}
            >
              {materialSymbol(
                "auto_fix_high",
                `mr-2 text-xs ${active ? "text-accent-strong" : "text-text-muted"}`,
              )}
              <span className="font-medium">{skill}</span>
            </ListRowButton>
          );
        })}
      </div>
    </PopoverSurface>
  );

  // Separate rendering branches keep spacing, sizing, and submit affordances tuned
  // for mouse/keyboard desktop usage vs touch-optimized mobile UX.
  if (variant === "desktop") {
    return (
      <div
        className={`relative flex flex-col gap-2 border border-border-default bg-surface-3 p-4 ${
          fillHeight ? "h-full" : ""
        }`}
      >
        {imageFilePicker}
        {imageAttachmentPreview}
        {imageLoadingMessage}
        {pasteErrorMessage}
        <div
          className={`flex min-h-0 gap-4 ${
            fillHeight ? "flex-1 items-stretch" : "items-end"
          }`}
        >
          <textarea
            ref={textareaRef}
            aria-label={composerAriaLabel}
            className={mergeClassNames(
              `min-w-0 flex-1 resize-none overflow-y-auto border-none bg-transparent px-2 font-body text-sm leading-6 placeholder:text-text-muted focus:outline-none focus:ring-0 ${
                fillHeight ? "h-full min-h-0" : ""
              }`,
              fillHeight
                ? "max-h-none"
                : "min-h-[var(--desktop-composer-min-height)] max-h-[var(--composer-max-height)]",
            )}
            name="chat-composer"
            placeholder={placeholder}
            rows={3}
            value={draft}
            onChange={onChatInputChange}
            onClick={refreshSkillsAutocompleteForCaret}
            onDragOver={onImageFileDragOver}
            onKeyDown={onComposerKeyDown}
            onKeyUp={refreshSkillsAutocompleteForCaret}
            onDrop={onImageFileDrop}
            onPaste={onPaste}
            onSelect={refreshSkillsAutocompleteForCaret}
            disabled={disabled}
          />
          {skillsPopover}
          <AppButton
            aria-label="Add image"
            buttonStyle="muted"
            disabled={disabled || !supportsImageInput}
            iconOnly
            onClick={onSelectImageFiles}
            title="Add image"
            type="button"
          >
            {materialSymbol("image")}
          </AppButton>
          <AppButton
            type="submit"
            buttonStyle={isWorking ? "error" : "primary"}
            iconOnly
            disabled={actionDisabled}
            aria-label={actionLabel}
            title={actionLabel}
          >
            {materialSymbol(isWorking ? "stop" : "arrow_forward")}
          </AppButton>
        </div>
      </div>
    );
  }

  return (
    <div className="relative bg-surface-2 px-2 py-2">
      {imageFilePicker}
      {imageAttachmentPreview || imageLoadingMessage || pasteErrorMessage ? (
        <div className="mb-2 space-y-2">
          {imageAttachmentPreview}
          {imageLoadingMessage}
          {pasteErrorMessage}
        </div>
      ) : null}
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          aria-label={composerAriaLabel}
          className={mergeClassNames(
            "min-h-0 min-w-0 flex-grow resize-none overflow-y-auto border border-border-default bg-surface-3 px-3 py-2 text-sm leading-6 text-text-primary placeholder:text-text-muted focus:border-focus-ring focus:outline-none",
            "min-h-[var(--mobile-composer-min-height)] max-h-[var(--composer-max-height)]",
          )}
          name="chat-composer"
          placeholder={placeholder}
          rows={1}
          value={draft}
          onChange={onChatInputChange}
          onClick={refreshSkillsAutocompleteForCaret}
          onDragOver={onImageFileDragOver}
          onKeyDown={onComposerKeyDown}
          onKeyUp={refreshSkillsAutocompleteForCaret}
          onDrop={onImageFileDrop}
          onPaste={onPaste}
          onSelect={refreshSkillsAutocompleteForCaret}
          disabled={disabled}
        />
        {skillsPopover}
        <AppButton
          aria-label="Add image"
          buttonStyle="muted"
          disabled={disabled || !supportsImageInput}
          iconOnly
          onClick={onSelectImageFiles}
          title="Add image"
          type="button"
        >
          {materialSymbol("image")}
        </AppButton>
        <AppButton
          buttonStyle={isWorking ? "error" : "primary"}
          iconOnly
          type="submit"
          disabled={actionDisabled}
          aria-label={actionLabel}
          title={actionLabel}
        >
          {materialSymbol(isWorking ? "stop" : "arrow_upward")}
        </AppButton>
      </div>
    </div>
  );
}
