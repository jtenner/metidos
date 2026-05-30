/**
 * @file src/mainview/app/folder-path-selector-control.tsx
 * @description Reusable filesystem-backed folder selector control.
 */

import type { FormEvent, JSX } from "react";
import { useId, useRef } from "react";
import { AppButton } from "../controls/button";
import { materialSymbol } from "../controls/icons";
import { ModalDialogSurface } from "../controls/popover";
import { formatDirectoryPathForInput } from "./path-display-state";
import { shortName } from "./project-worktree-state";

type FolderPathSelectorControlProps = {
  addProjectError: string;
  addProjectInputIsPreviewing: boolean;
  addProjectPath: string;
  directorySuggestions: string[];
  directorySuggestionsLoading: boolean;
  displayedAddProjectPath: string;
  homeDirectory: string;
  hoveredDirectorySuggestion: string | null;
  isAddingProject: boolean;
  onAddProjectPathChange: (value: string) => void;
  onClose: () => void;
  onDirectorySuggestionEnter: (directory: string) => void;
  onDirectorySuggestionLeave: (directory: string) => void;
  onSelectDirectorySuggestion: (directory: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  supportsTildePath: boolean;
  cancelLabel?: string;
  helpText?: string;
  inputName?: string;
  label?: string;
  submitLabel?: string;
  submitLoadingLabel?: string;
  createFolderPromptPath?: string | null;
  onCancelCreateFolderPrompt?: () => void;
  onConfirmCreateFolderPrompt?: () => void;
};

/**
 * Inline control for selecting/opening a folder via live filesystem suggestions.
 */
export function FolderPathSelectorControl({
  addProjectError,
  addProjectInputIsPreviewing,
  addProjectPath,
  directorySuggestions,
  directorySuggestionsLoading,
  displayedAddProjectPath,
  homeDirectory,
  hoveredDirectorySuggestion,
  isAddingProject,
  onAddProjectPathChange,
  onClose,
  onDirectorySuggestionEnter,
  onDirectorySuggestionLeave,
  onSelectDirectorySuggestion,
  onSubmit,
  supportsTildePath,
  cancelLabel = "Cancel",
  helpText = "Opens and pins the folder as a project.",
  inputName = "project-folder",
  label = "Project Folder",
  submitLabel = "Open",
  submitLoadingLabel = "Opening",
  createFolderPromptPath = null,
  onCancelCreateFolderPrompt,
  onConfirmCreateFolderPrompt,
}: FolderPathSelectorControlProps): JSX.Element {
  const createFolderTitleId = useId();
  const createFolderCancelRef = useRef<HTMLButtonElement | null>(null);
  return (
    <>
      <form
        className="space-y-2 border-b border-border-subtle px-3 py-2"
        onSubmit={onSubmit}
      >
        <label className="uppercase-label block text-accent-strong">
          {label}
          <div className="relative mt-2 space-y-2">
            <div className="flex items-start gap-2">
              <input
                aria-label={label}
                className={`min-w-0 flex-1 select-text border px-3 py-2 text-sm outline-none transition-all placeholder:text-text-muted focus:border-focus-ring ${
                  addProjectInputIsPreviewing
                    ? "border-focus-ring bg-surface-2 text-text-primary"
                    : "border-border-default bg-surface-2 text-text-primary"
                }`}
                name={inputName}
                placeholder={
                  supportsTildePath ? "~/project" : "/path/to/project"
                }
                value={displayedAddProjectPath}
                onChange={(event) => {
                  onAddProjectPathChange(event.currentTarget.value);
                }}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
              <AppButton buttonStyle="muted" onClick={onClose}>
                {cancelLabel}
              </AppButton>
              <AppButton
                buttonStyle="primary"
                disabled={isAddingProject}
                type="submit"
              >
                {isAddingProject ? submitLoadingLabel : submitLabel}
              </AppButton>
            </div>
            {addProjectPath.trim() &&
            (directorySuggestionsLoading || directorySuggestions.length > 0) ? (
              <div className="overflow-hidden border border-border-default bg-surface-overlay">
                <div className="flex items-center justify-between border-b border-border-subtle px-3 py-2">
                  <span className="uppercase-label-sm text-accent">
                    Folders
                  </span>
                  {directorySuggestionsLoading ? (
                    <span className="uppercase-label-sm text-text-faint">
                      Scanning
                    </span>
                  ) : null}
                </div>
                {directorySuggestions.length > 0 ? (
                  <div className="app-scrollbar max-h-96 overflow-y-auto overscroll-contain">
                    {directorySuggestions.map((directory) => {
                      const formattedDirectory = formatDirectoryPathForInput(
                        directory,
                        homeDirectory,
                        supportsTildePath,
                      );
                      return (
                        <AppButton
                          unstyled
                          type="button"
                          key={directory}
                          className={`flex w-full items-center gap-3 border-t border-border-subtle px-3 py-2 text-left transition-colors ${
                            hoveredDirectorySuggestion === directory
                              ? "bg-surface-2"
                              : "hover:bg-surface-1"
                          }`}
                          disabled={isAddingProject}
                          onMouseDown={(event) => event.preventDefault()}
                          onMouseEnter={() => {
                            onDirectorySuggestionEnter(directory);
                          }}
                          onMouseLeave={() => {
                            onDirectorySuggestionLeave(directory);
                          }}
                          onFocus={() => {
                            onDirectorySuggestionEnter(directory);
                          }}
                          onBlur={() => {
                            onDirectorySuggestionLeave(directory);
                          }}
                          onClick={() => {
                            onSelectDirectorySuggestion(directory);
                          }}
                        >
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center bg-surface-2 text-accent-strong">
                            {materialSymbol("folder", "text-base")}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium normal-case text-text-primary">
                              {shortName(directory)}
                            </div>
                            <div className="truncate text-xs normal-case text-text-muted">
                              {formattedDirectory}
                            </div>
                          </div>
                        </AppButton>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </label>
        {helpText ? (
          <p className="text-xs text-text-muted">{helpText}</p>
        ) : null}
        {addProjectError ? (
          <div className="text-xs text-danger-text">{addProjectError}</div>
        ) : null}
      </form>
      <ModalDialogSurface
        aria-labelledby={createFolderTitleId}
        backdropLabel="Cancel folder creation"
        className="w-full max-w-sm border border-border-default bg-surface-overlay p-4 text-text-primary shadow-overlay"
        initialFocusRef={createFolderCancelRef}
        onRequestClose={onCancelCreateFolderPrompt}
        open={Boolean(createFolderPromptPath)}
        restoreFocus={true}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 text-sm font-semibold text-text-primary">
            <span id={createFolderTitleId}>Would you like to create:</span>
            {createFolderPromptPath ? (
              <span className="ml-2 break-all font-mono font-medium text-text-secondary">
                {createFolderPromptPath}
              </span>
            ) : null}
          </div>
          <AppButton
            aria-label="Cancel folder creation"
            buttonStyle="muted"
            iconOnly
            onClick={onCancelCreateFolderPrompt}
          >
            {materialSymbol("close", "text-base")}
          </AppButton>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <AppButton
            buttonStyle="secondary"
            onClick={onCancelCreateFolderPrompt}
            ref={createFolderCancelRef}
          >
            Cancel
          </AppButton>
          <AppButton
            buttonStyle="primary"
            disabled={!onConfirmCreateFolderPrompt || isAddingProject}
            onClick={onConfirmCreateFolderPrompt}
          >
            {isAddingProject ? submitLoadingLabel : "Ok"}
          </AppButton>
        </div>
      </ModalDialogSurface>
    </>
  );
}
