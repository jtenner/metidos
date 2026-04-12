/**
 * @file src/mainview/app/projects-panel.tsx
 * @description Module for projects panel.
 */

import { type FormEvent, memo, useMemo } from "react";
import type { RpcProject, RpcWorktree } from "../../bun/rpc-schema";
import { materialSymbol } from "../controls/icons";
import {
  buildNormalizedSearchText,
  matchesNormalizedSearchText,
} from "../controls/search-utils";
import { SidebarSectionHeader } from "../controls/sidebar-section-header";
import { DESKTOP_THREAD_SWITCHER_POPOVER_ID } from "./desktop-thread-switcher";
import {
  toggleProjectsPanelOpen,
  useProjectsPanelOpen,
} from "./sidebar-panels-state";
import {
  findPrimaryWorktree,
  formatDirectoryPathForInput,
  orderProjectWorktrees,
  type ProjectNodeState,
  projectStateWorktrees,
  shortName,
  type WorktreeNodeState,
  worktreeKey,
  worktreeThreadPopoverAnchorId,
} from "./state";

export type ProjectsPanelRow = {
  kind: "project" | "subproject";
  project: RpcProject;
  worktree: RpcWorktree;
  worktreeLoaded: boolean;
};

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

export function deriveProjectsPanelRows(
  filteredProjects: RpcProject[],
  getProjectWorktrees: (projectId: number) => RpcWorktree[],
  normalizedSidebarSearchQuery: string,
  worktreeSearchTextByKey: ReadonlyMap<string, string>,
): ProjectsPanelRow[] {
  const rows: ProjectsPanelRow[] = [];

  for (const project of filteredProjects) {
    const worktrees = getProjectWorktrees(project.id);
    const primaryWorktree =
      findPrimaryWorktree(project, worktrees) ??
      createSyntheticPrimaryWorktree(project);
    const candidateRows: ProjectsPanelRow[] = [
      {
        kind: "project",
        project,
        worktree: primaryWorktree,
        worktreeLoaded: worktrees.some(
          (worktree) => worktree.path === project.path,
        ),
      },
      ...orderProjectWorktrees(
        project,
        worktrees.filter((worktree) => worktree.path !== project.path),
      ).map((worktree) => ({
        kind: "subproject" as const,
        project,
        worktree,
        worktreeLoaded: true,
      })),
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
  onOpenProjectActionMenu: (project: RpcProject, x: number, y: number) => void;
  onProjectWorktreeClick: (project: RpcProject, worktreePath: string) => void;
  onToggleWorktreePinned: (
    projectId: number,
    worktreePath: string,
    pinned: boolean,
  ) => void;
  onToggleWorktreeThreadSwitcher: (
    projectId: number,
    worktreePath: string,
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
  onOpenProjectActionMenu,
  onProjectWorktreeClick,
  onToggleWorktreePinned,
  onToggleWorktreeThreadSwitcher,
  row,
  sidebarActionButtonClass,
  threadSwitcherEnabled,
  threadSwitcherOpen,
  worktreePinBusyPath,
}: ProjectListRowProps) {
  const worktreePinned = Boolean(row.worktree.pinnedAt);
  const togglingPin = worktreePinBusyPath === row.worktree.path;
  const showPinButton = row.worktreeLoaded;
  const showProjectMenuButton = row.kind === "project";
  const showThreadSwitcherButton = threadSwitcherEnabled && activeWorktree;
  const rightPaddingClass =
    showProjectMenuButton && showThreadSwitcherButton
      ? "pr-24"
      : showProjectMenuButton || showThreadSwitcherButton
        ? "pr-16"
        : showPinButton
          ? "pr-10"
          : "pr-4";
  const secondaryLabel = row.worktree.branch?.trim()
    ? `${row.worktree.branch} · ${displayPath}`
    : displayPath;

  return (
    <div className="group/worktree relative">
      <button
        type="button"
        className={`flex w-full min-w-0 items-center gap-2.5 px-2.5 py-2 text-left transition-colors ${
          activeWorktree
            ? "bg-surface-2 text-text-primary shadow-[inset_2px_0_0_0_var(--color-accent-emphasis)]"
            : "text-text-secondary hover:bg-surface-1"
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
          className={`flex h-6 w-6 shrink-0 items-center justify-center ${
            activeWorktree
              ? "bg-surface-3 text-accent-strong"
              : "bg-surface-2 text-accent"
          }`}
        >
          {materialSymbol(
            activeWorktree ? "folder_open" : "folder",
            "text-[14px]",
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <div
              className="truncate text-[13px] font-medium leading-4"
              title={shortName(row.worktree.path)}
            >
              {shortName(row.worktree.path)}
            </div>
            {row.kind === "subproject" ? (
              <span className="shrink-0 rounded-full border border-[#334651] bg-[#131d23] px-1.5 py-0.5 font-label text-[9px] font-semibold uppercase tracking-[0.14em] text-[#9fc1da]">
                Subproject
              </span>
            ) : null}
          </div>
          <div className="mt-0.5 truncate text-[10px] leading-[0.85rem] text-[#8f9aa2]">
            {secondaryLabel}
          </div>
        </div>
      </button>

      {showProjectMenuButton ? (
        <button
          type="button"
          className={`${sidebarActionButtonClass} absolute top-1/2 -translate-y-1/2 ${
            showThreadSwitcherButton ? "right-14" : "right-8"
          } ${
            activeWorktree
              ? "opacity-100"
              : "pointer-events-none opacity-0 group-hover/worktree:pointer-events-auto group-hover/worktree:opacity-100 group-focus-within/worktree:pointer-events-auto group-focus-within/worktree:opacity-100"
          }`}
          onClick={(event) => {
            event.stopPropagation();
            const rect = event.currentTarget.getBoundingClientRect();
            onOpenProjectActionMenu(
              row.project,
              rect.right + 8,
              rect.bottom + 6,
            );
          }}
          aria-label={`Project actions for ${row.project.name}`}
        >
          {materialSymbol("menu", "text-[14px]")}
        </button>
      ) : null}

      {showThreadSwitcherButton ? (
        <button
          type="button"
          id={worktreeThreadPopoverAnchorId(row.project.id, row.worktree.path)}
          className={`absolute right-8 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center border transition-colors ${
            threadSwitcherOpen
              ? "border-[#4a6274] bg-[#24333b] text-[#dfebf3]"
              : "border-[#303940] bg-[#1a2025] text-[#acb8c1] hover:bg-[#242d33] hover:text-[#f2f0ef]"
          }`}
          onClick={(event) => {
            event.stopPropagation();
            onToggleWorktreeThreadSwitcher(row.project.id, row.worktree.path);
          }}
          aria-controls={DESKTOP_THREAD_SWITCHER_POPOVER_ID}
          aria-expanded={threadSwitcherOpen}
          aria-label={
            threadSwitcherOpen
              ? "Close thread switcher"
              : "Open thread switcher"
          }
          title={threadSwitcherOpen ? "Close thread switcher" : "Threads"}
        >
          {materialSymbol("chat_bubble", "text-[13px]")}
        </button>
      ) : null}

      {showPinButton ? (
        <button
          type="button"
          className={`absolute right-2 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center border transition-[opacity,color,background-color,border-color] disabled:cursor-not-allowed disabled:opacity-60 ${worktreePinButtonVisibilityClassName(
            worktreePinned,
          )} ${
            activeWorktree
              ? "border-[#35414a] bg-[#1f282f] text-[#dfebf3]"
              : "border-[#303940] bg-[#1a2025] text-[#acb8c1] hover:bg-[#242d33] hover:text-[#f2f0ef]"
          }`}
          onClick={() => {
            onToggleWorktreePinned(
              row.project.id,
              row.worktree.path,
              worktreePinned,
            );
          }}
          disabled={togglingPin || worktreePinBusyPath !== null}
          aria-label={worktreePinned ? "Unpin subproject" : "Pin subproject"}
          title={worktreePinned ? "Unpin subproject" : "Pin subproject"}
        >
          {materialSymbol("push_pin", "text-[13px]", {
            filled: worktreePinned,
          })}
        </button>
      ) : null}

      {error ? (
        <div className="px-3 pt-1 text-[11px] text-[#ff6e84]">{error}</div>
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
  onToggleAddProjectForm: () => void;
  onToggleWorktreePinned: (
    projectId: number,
    worktreePath: string,
    pinned: boolean,
  ) => void;
  onToggleWorktreeThreadSwitcher: (
    projectId: number,
    worktreePath: string,
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
  onToggleAddProjectForm,
  onToggleWorktreePinned,
  onToggleWorktreeThreadSwitcher,
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
    <section className="select-none">
      <SidebarSectionHeader
        title="Projects"
        open={projectsOpen}
        onToggle={toggleProjectsPanelOpen}
        action={
          <button
            type="button"
            className={sidebarActionButtonClass}
            onClick={onToggleAddProjectForm}
            aria-label={addProjectOpen ? "Close add project" : "Add project"}
          >
            +
          </button>
        }
      />
      {projectsOpen ? (
        <div className="mt-3 space-y-3">
          {addProjectOpen ? (
            <form
              className="space-y-2 border border-[#23282c] bg-[#151515] px-3 py-2.5"
              onSubmit={onSubmitAddProject}
            >
              <label className="block text-[10px] font-label uppercase tracking-widest text-[#bdd5e6]">
                Project Folder
                <div className="relative mt-2 space-y-2">
                  <div className="flex items-start gap-2">
                    <input
                      className={`min-w-0 flex-1 select-text border px-3 py-2 text-sm outline-none transition-all placeholder:text-[#6f6f6f] focus:border-[#99bed9] ${
                        addProjectInputIsPreviewing
                          ? "border-[#9fc1da] bg-[#1a2025] text-[#ffffff] shadow-[0_0_0_1px_rgba(159,193,218,0.18)]"
                          : "border-[#3b3b3b] bg-[#101010] text-[#f2f0ef]"
                      }`}
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
                    <button
                      type="submit"
                      className="bg-[#bdd5e6] px-3 py-2 font-label text-[10px] font-bold uppercase tracking-wider text-[#2e526b] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={isAddingProject}
                    >
                      {isAddingProject ? "Adding" : "Add"}
                    </button>
                  </div>
                  {addProjectPath.trim() ? (
                    <div className="overflow-hidden border border-[#2f3f4b] bg-[#101315]/95 shadow-[0_14px_32px_rgba(0,0,0,0.45)] backdrop-blur-xl">
                      <div className="flex items-center justify-between border-b border-[#283036] px-3 py-2">
                        <span className="font-label text-[10px] uppercase tracking-widest text-[#98b9d0]">
                          Folders
                        </span>
                        {directorySuggestionsLoading ? (
                          <span className="text-[10px] uppercase tracking-widest text-[#727e86]">
                            Scanning
                          </span>
                        ) : null}
                      </div>
                      {directorySuggestions.length === 0 &&
                      !directorySuggestionsLoading ? (
                        <div className="px-3 py-3 text-xs text-[#7d7d8d]">
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
                              <button
                                type="button"
                                key={directory}
                                className={`flex w-full items-center gap-3 border-t border-[#1e2327] px-3 py-2 text-left transition-colors ${
                                  hoveredDirectorySuggestion === directory
                                    ? "bg-[#1f282f]"
                                    : "hover:bg-[#1c2226]"
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
                                <div
                                  className={`flex h-8 w-8 shrink-0 items-center justify-center text-[#bdd5e6] ${
                                    hoveredDirectorySuggestion === directory
                                      ? "bg-[#26353f]"
                                      : "bg-[#1b252c]"
                                  }`}
                                >
                                  {materialSymbol("folder", "text-[18px]")}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="truncate text-sm font-medium normal-case text-[#f2f0ef]">
                                    {shortName(directory)}
                                  </div>
                                  <div className="truncate text-[11px] normal-case text-[#8f9aa2]">
                                    {formattedDirectory}
                                  </div>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </label>
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-[#8f8d8b]">
                  Adds the folder as a project and initializes Git if needed.
                </p>
                <button
                  type="button"
                  className="font-label text-[10px] uppercase tracking-widest text-[#adabaa] transition-colors hover:text-[#f2f0ef]"
                  onClick={onCloseAddProjectForm}
                >
                  Cancel
                </button>
              </div>
              {addProjectError ? (
                <div className="text-xs text-[#ff6e84]">{addProjectError}</div>
              ) : null}
            </form>
          ) : null}

          <div className="space-y-1">
            {projectRows.length === 0 ? (
              <div className="bg-[#151515] px-3 py-2.5 text-[13px] text-[#a7a7a7]">
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
                    onOpenProjectActionMenu={onOpenProjectActionMenu}
                    onProjectWorktreeClick={onProjectWorktreeClick}
                    onToggleWorktreePinned={onToggleWorktreePinned}
                    onToggleWorktreeThreadSwitcher={
                      onToggleWorktreeThreadSwitcher
                    }
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
        </div>
      ) : null}
    </section>
  );
});
