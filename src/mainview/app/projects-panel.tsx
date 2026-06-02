/**
 * @file src/mainview/app/projects-panel.tsx
 * @description Module for projects panel.
 */

import { type FormEvent, memo, useMemo } from "react";
import type { RpcProject, RpcWorktree } from "../../bun/rpc-schema";
import { AppButton } from "../controls/button";
import { materialSymbol } from "../controls/icons";
import {
  buildNormalizedSearchText,
  matchesNormalizedSearchText,
} from "../controls/search-utils";
import { SidebarSectionHeader } from "../controls/sidebar-section-header";
import {
  DESKTOP_THREAD_SWITCHER_POPOVER_ID,
  deferCloseDesktopThreadSwitcher,
} from "./desktop-thread-switcher";
import { formatDirectoryPathForInput } from "./path-display-state";
import {
  orderProjectWorktrees,
  type ProjectNodeState,
  projectStateWorktrees,
  shortName,
  type WorktreeNodeState,
  worktreeKey,
} from "./project-worktree-state";
import {
  toggleProjectsPanelOpen,
  useProjectsPanelOpen,
} from "./sidebar-panels-state";
import { worktreeThreadPopoverAnchorId } from "./thread-ui-state";

export type ProjectsPanelRow = {
  kind: "project" | "subproject";
  project: RpcProject;
  worktree: RpcWorktree;
  worktreeLoaded: boolean;
};

const PROJECTS_PANEL_TITLE_ID = "projects-panel-title";
const PROJECTS_PANEL_REGION_ID = "projects-panel-region";

function createSyntheticPrimaryWorktree(project: RpcProject): RpcWorktree {
  return {
    bare: false,
    branch: null,
    head: null,
    path: project.path,
    pinnedAt: null,
  };
}

function rowSearchText(row: ProjectsPanelRow): string {
  return buildNormalizedSearchText(
    row.project.name,
    row.worktree.branch,
    row.worktree.path,
  );
}

export function worktreePinButtonVisibilityClassName(
  worktreePinned: boolean,
): string {
  if (worktreePinned) {
    return "opacity-100";
  }

  return "pointer-events-none opacity-0 group-hover/worktree:pointer-events-auto group-hover/worktree:opacity-100 group-focus-within/worktree:pointer-events-auto group-focus-within/worktree:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100";
}

export function worktreeThreadSwitcherAriaLabel(
  threadSwitcherOpen: boolean,
  worktreeLabel: string,
): string {
  return threadSwitcherOpen
    ? `Close thread switcher for ${worktreeLabel}`
    : `Open thread switcher for ${worktreeLabel}`;
}

export function worktreePinButtonAriaLabel(
  worktreePinned: boolean,
  worktreeLabel: string,
): string {
  return worktreePinned
    ? `Unpin worktree ${worktreeLabel}`
    : `Pin worktree ${worktreeLabel}`;
}

export function deriveProjectsPanelRows(
  filteredProjects: RpcProject[],
  getProjectWorktrees: (projectId: number) => RpcWorktree[],
  normalizedSidebarSearchQuery: string,
  worktreeSearchTextByKey: ReadonlyMap<string, string>,
): ProjectsPanelRow[] {
  const rows: ProjectsPanelRow[] = [];

  for (const project of filteredProjects) {
    const worktrees = getProjectWorktrees(project.id);
    let primaryWorktree: RpcWorktree | null = null;
    const subprojectWorktrees: RpcWorktree[] = [];

    for (const worktree of worktrees) {
      if (worktree.path === project.path) {
        primaryWorktree = worktree;
        continue;
      }
      subprojectWorktrees.push(worktree);
    }

    const candidateRows: ProjectsPanelRow[] = [
      {
        kind: "project",
        project,
        worktree: primaryWorktree ?? createSyntheticPrimaryWorktree(project),
        worktreeLoaded: primaryWorktree !== null,
      },
      ...orderProjectWorktrees(project, subprojectWorktrees).map(
        (worktree) => ({
          kind: "subproject" as const,
          project,
          worktree,
          worktreeLoaded: true,
        }),
      ),
    ];

    for (const row of candidateRows) {
      if (!normalizedSidebarSearchQuery) {
        rows.push(row);
        continue;
      }

      const searchText = row.worktreeLoaded
        ? (worktreeSearchTextByKey.get(
            worktreeKey(row.project.id, row.worktree.path),
          ) ?? rowSearchText(row))
        : rowSearchText(row);
      if (
        !matchesNormalizedSearchText(normalizedSidebarSearchQuery, searchText)
      ) {
        continue;
      }
      rows.push(row);
    }
  }

  return rows;
}

type ProjectListRowProps = {
  activeWorktree: boolean;
  displayPath: string;
  error: string;
  onCloseWorktreeThreadSwitcher: (restoreFocus?: boolean) => void;
  onOpenProjectActionMenu: (project: RpcProject, x: number, y: number) => void;
  onProjectWorktreeClick: (project: RpcProject, worktreePath: string) => void;
  onOpenWorktreeThreadSwitcher: (
    projectId: number,
    worktreePath: string,
  ) => void;
  onToggleWorktreePinned: (
    projectId: number,
    worktreePath: string,
    pinned: boolean,
  ) => void;
  row: ProjectsPanelRow;
  sidebarActionButtonClass: string;
  threadSwitcherEnabled: boolean;
  threadSwitcherOpen: boolean;
  worktreePinBusyPath: string | null;
};

function ProjectListRow({
  activeWorktree,
  displayPath,
  error,
  onCloseWorktreeThreadSwitcher,
  onOpenProjectActionMenu,
  onProjectWorktreeClick,
  onOpenWorktreeThreadSwitcher,
  onToggleWorktreePinned,
  row,
  sidebarActionButtonClass,
  threadSwitcherEnabled,
  threadSwitcherOpen,
  worktreePinBusyPath,
}: ProjectListRowProps) {
  const worktreePinned = Boolean(row.worktree.pinnedAt);
  const rowWorktreeKey = worktreeKey(row.project.id, row.worktree.path);
  const togglingPin = worktreePinBusyPath === rowWorktreeKey;
  const showPinButton = row.worktreeLoaded;
  const showProjectMenuButton = row.kind === "project";
  const showThreadSwitcherButton = threadSwitcherEnabled && activeWorktree;
  const threadSwitcherAnchorId = worktreeThreadPopoverAnchorId(
    row.project.id,
    row.worktree.path,
  );
  const trailingActionCount = [
    showProjectMenuButton,
    showThreadSwitcherButton,
    showPinButton,
  ].filter(Boolean).length;
  const rightPaddingClass =
    trailingActionCount >= 3
      ? "pr-28"
      : trailingActionCount === 2
        ? "pr-20"
        : trailingActionCount === 1
          ? "pr-12"
          : "pr-4";
  const secondaryLabel = row.worktree.branch?.trim()
    ? `${row.worktree.branch} · ${displayPath}`
    : displayPath;
  const worktreeAriaLabel = shortName(row.worktree.path);
  const threadSwitcherAriaLabel = worktreeThreadSwitcherAriaLabel(
    threadSwitcherOpen,
    worktreeAriaLabel,
  );
  const pinButtonAriaLabel = worktreePinButtonAriaLabel(
    worktreePinned,
    worktreeAriaLabel,
  );
  const openThreadSwitcher = (): void => {
    onOpenWorktreeThreadSwitcher(row.project.id, row.worktree.path);
  };
  const deferCloseThreadSwitcher = (): void => {
    deferCloseDesktopThreadSwitcher(
      threadSwitcherAnchorId,
      onCloseWorktreeThreadSwitcher,
      false,
    );
  };

  return (
    <div
      className="group/worktree relative"
      onMouseEnter={showThreadSwitcherButton ? openThreadSwitcher : undefined}
      onMouseLeave={
        showThreadSwitcherButton ? deferCloseThreadSwitcher : undefined
      }
      role="none"
    >
      <AppButton
        unstyled
        type="button"
        className={`flex w-full min-w-0 items-center gap-3 border-l-2 px-3 py-2 text-left transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-focus-ring focus-visible:outline-offset-[-1px] ${
          activeWorktree
            ? "border-l-accent-emphasis bg-surface-2 text-text-primary"
            : "border-l-transparent text-text-secondary hover:bg-surface-1"
        } ${rightPaddingClass}`}
        onClick={() => {
          onProjectWorktreeClick(row.project, row.worktree.path);
        }}
        onContextMenu={
          showProjectMenuButton
            ? (event) => {
                event.preventDefault();
                onOpenProjectActionMenu(
                  row.project,
                  event.clientX + 6,
                  event.clientY + 6,
                );
              }
            : undefined
        }
      >
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center ${
            activeWorktree
              ? "bg-surface-3 text-accent-strong"
              : "bg-surface-2 text-accent"
          }`}
        >
          {row.project.faviconDataUrl ? (
            <img
              alt=""
              aria-hidden="true"
              className="h-4 w-4 object-contain"
              decoding="async"
              src={row.project.faviconDataUrl}
            />
          ) : (
            materialSymbol(
              activeWorktree ? "folder_open" : "folder",
              "text-[14px]",
            )
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div
            className="truncate text-[14px] font-medium leading-4"
            title={shortName(row.worktree.path)}
          >
            {shortName(row.worktree.path)}
          </div>
          <div className="mt-1 truncate text-[11px] leading-4 text-text-muted">
            {secondaryLabel}
          </div>
        </div>
      </AppButton>

      {showProjectMenuButton ? (
        <AppButton
          aria-label={`Project actions for ${row.project.name}`}
          buttonStyle="muted"
          className={`${sidebarActionButtonClass} absolute top-1/2 -translate-y-1/2 ${
            showThreadSwitcherButton ? "right-16" : "right-8"
          } ${
            activeWorktree
              ? "opacity-100"
              : "pointer-events-none opacity-0 group-hover/worktree:pointer-events-auto group-hover/worktree:opacity-100 group-focus-within/worktree:pointer-events-auto group-focus-within/worktree:opacity-100"
          }`}
          iconOnly
          onClick={(event) => {
            event.stopPropagation();
            const rect = event.currentTarget.getBoundingClientRect();
            onOpenProjectActionMenu(
              row.project,
              rect.right + 8,
              rect.bottom + 6,
            );
          }}
          type="button"
        >
          {materialSymbol("menu", "text-[15px]")}
        </AppButton>
      ) : null}

      {showThreadSwitcherButton ? (
        <AppButton
          unstyled
          type="button"
          id={threadSwitcherAnchorId}
          className={`absolute right-10 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center border transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-focus-ring focus-visible:outline-offset-1 ${
            threadSwitcherOpen
              ? "border-accent bg-surface-2 text-text-secondary"
              : "border-border-default bg-surface-2 text-text-muted hover:bg-hover-surface hover:text-text-primary"
          }`}
          onClick={(event) => {
            event.stopPropagation();
            if (threadSwitcherOpen) {
              onCloseWorktreeThreadSwitcher(false);
              return;
            }

            openThreadSwitcher();
          }}
          onFocus={openThreadSwitcher}
          onBlur={deferCloseThreadSwitcher}
          aria-controls={DESKTOP_THREAD_SWITCHER_POPOVER_ID}
          aria-expanded={threadSwitcherOpen}
          aria-label={threadSwitcherAriaLabel}
          title={threadSwitcherAriaLabel}
        >
          {materialSymbol("chat_bubble", "text-[16px]")}
        </AppButton>
      ) : null}

      {showPinButton ? (
        <AppButton
          unstyled
          type="button"
          className={`absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center border transition-[opacity,color,background-color,border-color] focus-visible:outline focus-visible:outline-1 focus-visible:outline-focus-ring focus-visible:outline-offset-1 disabled:cursor-not-allowed disabled:opacity-60 ${worktreePinButtonVisibilityClassName(
            worktreePinned,
          )} ${
            activeWorktree
              ? "border-border-default bg-surface-2 text-text-secondary"
              : "border-border-default bg-surface-2 text-text-muted hover:bg-hover-surface hover:text-text-primary"
          }`}
          onClick={() => {
            onToggleWorktreePinned(
              row.project.id,
              row.worktree.path,
              worktreePinned,
            );
          }}
          disabled={togglingPin}
          aria-label={pinButtonAriaLabel}
          title={pinButtonAriaLabel}
        >
          {materialSymbol("push_pin", "text-[16px]", {
            filled: worktreePinned,
          })}
        </AppButton>
      ) : null}

      {error ? (
        <div className="px-3 pt-1 text-[11px] text-danger-text">{error}</div>
      ) : null}
    </div>
  );
}

type ProjectsPanelProps = {
  addProjectError: string;
  addProjectInputIsPreviewing: boolean;
  addProjectOpen: boolean;
  addProjectPath: string;
  directorySuggestions: string[];
  directorySuggestionsLoading: boolean;
  displayedAddProjectPath: string;
  filteredProjects: RpcProject[];
  getProjectState: (projectId: number) => ProjectNodeState;
  getWorktreeState: (
    projectId: number,
    worktreePath: string,
  ) => WorktreeNodeState;
  homeDirectory: string;
  hoveredDirectorySuggestion: string | null;
  isActiveWorktree: (projectId: number, worktreePath: string) => boolean;
  isAddingProject: boolean;
  normalizedSidebarSearchQuery: string;
  onAddProjectPathChange: (value: string) => void;
  onCloseAddProjectForm: () => void;
  onDirectorySuggestionEnter: (directory: string) => void;
  onDirectorySuggestionLeave: (directory: string) => void;
  onOpenProjectActionMenu: (project: RpcProject, x: number, y: number) => void;
  onProjectWorktreeClick: (project: RpcProject, worktreePath: string) => void;
  onSelectDirectorySuggestion: (directory: string) => void;
  onSubmitAddProject: (event: FormEvent<HTMLFormElement>) => void;
  onCloseWorktreeThreadSwitcher: (restoreFocus?: boolean) => void;
  onOpenWorktreeThreadSwitcher: (
    projectId: number,
    worktreePath: string,
  ) => void;
  onToggleAddProjectForm: () => void;
  onToggleWorktreePinned: (
    projectId: number,
    worktreePath: string,
    pinned: boolean,
  ) => void;
  sidebarActionButtonClass: string;
  supportsTildePath: boolean;
  threadSwitcherEnabled: boolean;
  threadSwitcherOpen: boolean;
  worktreePinBusyPath: string | null;
  worktreeDisplayPathByKey: ReadonlyMap<string, string>;
  worktreeSearchTextByKey: ReadonlyMap<string, string>;
};

export const ProjectsPanel = memo(function ProjectsPanel({
  addProjectError,
  addProjectInputIsPreviewing,
  addProjectOpen,
  addProjectPath,
  directorySuggestions,
  directorySuggestionsLoading,
  displayedAddProjectPath,
  filteredProjects,
  getProjectState,
  getWorktreeState,
  homeDirectory,
  hoveredDirectorySuggestion,
  isActiveWorktree,
  isAddingProject,
  normalizedSidebarSearchQuery,
  onAddProjectPathChange,
  onCloseAddProjectForm,
  onDirectorySuggestionEnter,
  onDirectorySuggestionLeave,
  onOpenProjectActionMenu,
  onProjectWorktreeClick,
  onSelectDirectorySuggestion,
  onSubmitAddProject,
  onCloseWorktreeThreadSwitcher,
  onOpenWorktreeThreadSwitcher,
  onToggleAddProjectForm,
  onToggleWorktreePinned,
  sidebarActionButtonClass,
  supportsTildePath,
  threadSwitcherEnabled,
  threadSwitcherOpen,
  worktreePinBusyPath,
  worktreeDisplayPathByKey,
  worktreeSearchTextByKey,
}: ProjectsPanelProps) {
  const projectsOpen = useProjectsPanelOpen();
  const projectRows = useMemo(
    () =>
      deriveProjectsPanelRows(
        filteredProjects,
        (projectId) => projectStateWorktrees(getProjectState(projectId)),
        normalizedSidebarSearchQuery,
        worktreeSearchTextByKey,
      ),
    [
      filteredProjects,
      getProjectState,
      normalizedSidebarSearchQuery,
      worktreeSearchTextByKey,
    ],
  );

  return (
    <section aria-labelledby={PROJECTS_PANEL_TITLE_ID} className="select-none">
      <SidebarSectionHeader
        controlsId={PROJECTS_PANEL_REGION_ID}
        title="Projects"
        titleId={PROJECTS_PANEL_TITLE_ID}
        open={projectsOpen}
        onToggle={toggleProjectsPanelOpen}
        action={
          <AppButton
            aria-label={addProjectOpen ? "Close add project" : "Add project"}
            buttonStyle="muted"
            className={sidebarActionButtonClass}
            iconOnly
            onClick={onToggleAddProjectForm}
            type="button"
          >
            {materialSymbol("plus", "text-[15px]")}
          </AppButton>
        }
      />
      {projectsOpen ? (
        <section
          id={PROJECTS_PANEL_REGION_ID}
          aria-labelledby={PROJECTS_PANEL_TITLE_ID}
          className="mt-3 space-y-3"
        >
          {addProjectOpen ? (
            <form className="space-y-2 px-3 py-2" onSubmit={onSubmitAddProject}>
              <label className="uppercase-label block text-accent-strong">
                Project Folder
                <div className="relative mt-2 space-y-2">
                  <div className="flex items-start gap-2">
                    <input
                      aria-label="Project folder"
                      className={`min-w-0 flex-1 select-text border px-3 py-2 text-sm outline-none transition-all placeholder:text-text-faint focus:border-focus-ring ${
                        addProjectInputIsPreviewing
                          ? "border-focus-ring bg-surface-2 text-text-primary"
                          : "border-border-default bg-surface-2 text-text-primary"
                      }`}
                      name="project-folder"
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
                    <AppButton
                      buttonStyle="primary"
                      type="submit"
                      disabled={isAddingProject}
                    >
                      {isAddingProject ? "Adding" : "Add"}
                    </AppButton>
                  </div>
                  {addProjectPath.trim() ? (
                    <div className="overflow-hidden border border-border-default bg-surface-1">
                      <div className="flex items-center justify-between border-b border-border-subtle bg-surface-1 px-3 py-2">
                        <span className="uppercase-label-sm text-accent">
                          Folders
                        </span>
                        {directorySuggestionsLoading ? (
                          <span className="uppercase-label-sm text-text-faint">
                            Scanning
                          </span>
                        ) : null}
                      </div>
                      {directorySuggestions.length === 0 &&
                      !directorySuggestionsLoading ? (
                        <div className="bg-surface-1 px-3 py-2 text-xs text-text-muted">
                          No matching folders.
                        </div>
                      ) : null}
                      {directorySuggestions.length > 0 ? (
                        <div className="app-scrollbar max-h-[30rem] overflow-y-auto overscroll-contain">
                          {directorySuggestions.map((directory) => {
                            const formattedDirectory =
                              formatDirectoryPathForInput(
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
                                    : "hover:bg-hover-surface"
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
                                  {materialSymbol("folder", "text-[19px]")}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="truncate text-sm font-medium normal-case text-text-primary">
                                    {shortName(directory)}
                                  </div>
                                  <div className="truncate text-[11px] normal-case text-text-muted">
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
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-text-muted">
                  Adds the folder as a project.
                </p>
                <AppButton buttonStyle="muted" onClick={onCloseAddProjectForm}>
                  Cancel
                </AppButton>
              </div>
              {addProjectError ? (
                <div className="text-xs text-danger-text">
                  {addProjectError}
                </div>
              ) : null}
            </form>
          ) : null}

          <div className="space-y-1">
            {projectRows.length === 0 ? (
              <div className="bg-surface-1 px-3 py-2 text-xs text-text-muted">
                {normalizedSidebarSearchQuery
                  ? "No matching projects."
                  : "Use + to add a project folder."}
              </div>
            ) : (
              projectRows.map((row) => {
                const key = worktreeKey(row.project.id, row.worktree.path);
                const projectState = getProjectState(row.project.id);
                const worktreeState = getWorktreeState(
                  row.project.id,
                  row.worktree.path,
                );
                return (
                  <ProjectListRow
                    key={key}
                    activeWorktree={isActiveWorktree(
                      row.project.id,
                      row.worktree.path,
                    )}
                    displayPath={
                      worktreeDisplayPathByKey.get(key) ?? row.worktree.path
                    }
                    error={
                      worktreeState.error ||
                      (row.kind === "project" ? projectState.error : "")
                    }
                    onCloseWorktreeThreadSwitcher={
                      onCloseWorktreeThreadSwitcher
                    }
                    onOpenProjectActionMenu={onOpenProjectActionMenu}
                    onProjectWorktreeClick={onProjectWorktreeClick}
                    onOpenWorktreeThreadSwitcher={onOpenWorktreeThreadSwitcher}
                    onToggleWorktreePinned={onToggleWorktreePinned}
                    row={row}
                    sidebarActionButtonClass={sidebarActionButtonClass}
                    threadSwitcherEnabled={threadSwitcherEnabled}
                    threadSwitcherOpen={threadSwitcherOpen}
                    worktreePinBusyPath={worktreePinBusyPath}
                  />
                );
              })
            )}
          </div>
        </section>
      ) : null}
    </section>
  );
});
