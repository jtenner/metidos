/**
 * @file src/mainview/app/projects-panel.tsx
 * @description Module for projects panel.
 */

import {
  measureElement as defaultMeasureElement,
  useVirtualizer,
} from "@tanstack/react-virtual";
import { type FormEvent, memo, useMemo, useRef } from "react";
import type { RpcProject, RpcWorktree } from "../../bun/rpc-schema";
import { materialSymbol } from "../controls/icons";
import { matchesNormalizedSearchText } from "../controls/search-utils";
import { SidebarSectionHeader } from "../controls/sidebar-section-header";
import { DESKTOP_THREAD_SWITCHER_POPOVER_ID } from "./desktop-thread-switcher";
import {
  toggleProjectsPanelOpen,
  useOpenProjectPaths,
  useProjectsPanelOpen,
} from "./sidebar-panels-state";
import {
  formatDirectoryPathForInput,
  orderProjectWorktrees,
  type ProjectNodeState,
  projectStateWorktrees,
  shortName,
  type WorktreeNodeState,
  worktreeKey,
  worktreeThreadPopoverAnchorId,
} from "./state";

type ProjectWorktreeListData = {
  visibleWorktrees: RpcWorktree[];
};

const PROJECT_WORKTREE_ROW_ESTIMATE_PX = 56;
const PROJECT_WORKTREE_LIST_OVERSCAN = 6;

export function worktreePinButtonVisibilityClassName(
  worktreePinned: boolean,
): string {
  if (worktreePinned) {
    return "opacity-100";
  }

  return "pointer-events-none opacity-0 group-hover/worktree:pointer-events-auto group-hover/worktree:opacity-100 group-focus-within/worktree:pointer-events-auto group-focus-within/worktree:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100";
}

/**
 * Row props for one worktree entry in the project selector list.
 */
type ProjectWorktreeRowProps = {
  activeWorktree: boolean;
  displayPath: string;
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
  project: RpcProject;
  threadSwitcherEnabled: boolean;
  threadSwitcherOpen: boolean;
  worktree: RpcWorktree;
  worktreePinBusyPath: string | null;
  worktreeState: WorktreeNodeState;
};

/**
 * Match a project/worktree pair against sidebar search query.
 */
function worktreeMatchesProjectsSearch(
  normalizedSidebarSearchQuery: string,
  worktreeSearchTextByKey: ReadonlyMap<string, string>,
  projectId: number,
  worktree: RpcWorktree,
): boolean {
  return matchesNormalizedSearchText(
    normalizedSidebarSearchQuery,
    worktreeSearchTextByKey.get(worktreeKey(projectId, worktree.path)) ?? "",
  );
}

/**
 * Derives projects panel worktree data.
 */
export function deriveProjectsPanelWorktreeData(
  filteredProjects: RpcProject[],
  getProjectWorktrees: (projectId: number) => RpcWorktree[],
  normalizedSidebarSearchQuery: string,
  worktreeSearchTextByKey: ReadonlyMap<string, string>,
): ReadonlyMap<number, ProjectWorktreeListData> {
  const projectWorktreeDataById = new Map<number, ProjectWorktreeListData>();

  for (const project of filteredProjects) {
    const orderedWorktrees = orderProjectWorktrees(
      project,
      getProjectWorktrees(project.id),
    );
    const visibleWorktrees: RpcWorktree[] = [];

    for (const worktree of orderedWorktrees) {
      if (
        !worktreeMatchesProjectsSearch(
          normalizedSidebarSearchQuery,
          worktreeSearchTextByKey,
          project.id,
          worktree,
        )
      ) {
        continue;
      }

      visibleWorktrees.push(worktree);
    }

    projectWorktreeDataById.set(project.id, {
      visibleWorktrees,
    });
  }

  return projectWorktreeDataById;
}

/**
 * Render a selectable worktree row with pin/unpin affordance.
 */
function ProjectWorktreeRow({
  activeWorktree,
  displayPath,
  onProjectWorktreeClick,
  onToggleWorktreePinned,
  onToggleWorktreeThreadSwitcher,
  project,
  threadSwitcherEnabled,
  threadSwitcherOpen,
  worktree,
  worktreePinBusyPath,
  worktreeState,
}: ProjectWorktreeRowProps) {
  const worktreePinned = Boolean(worktree.pinnedAt);
  const togglingPin = worktreePinBusyPath === worktree.path;
  const showThreadSwitcherButton = threadSwitcherEnabled && activeWorktree;

  return (
    <div className="group/worktree relative">
      <button
        type="button"
        className={`flex w-full min-w-0 items-center gap-2.5 px-2.5 py-1.5 text-left transition-colors ${
          activeWorktree
            ? "bg-surface-2 text-text-primary shadow-[inset_2px_0_0_0_var(--color-accent-emphasis)]"
            : "text-text-secondary hover:bg-surface-1"
        } ${showThreadSwitcherButton ? "pr-16" : "pr-10"}`}
        onClick={() => {
          onProjectWorktreeClick(project, worktree.path);
        }}
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
          <div
            className="truncate text-[13px] font-medium leading-4"
            title={shortName(worktree.path)}
          >
            {shortName(worktree.path)}
          </div>
          <div className="mt-0.5 flex items-center gap-1 truncate text-[10px] leading-[0.85rem] text-[#8f9aa2]">
            <span
              aria-hidden="true"
              className="text-[12px] leading-none text-[#a7b5be]"
            >
              ⎇
            </span>
            <span>
              {worktree.branch ?? "Primary"} · {displayPath}
            </span>
          </div>
        </div>
      </button>
      {showThreadSwitcherButton ? (
        <button
          type="button"
          id={worktreeThreadPopoverAnchorId(project.id, worktree.path)}
          className={`absolute right-8 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center border transition-colors ${
            threadSwitcherOpen
              ? "border-[#4a6274] bg-[#24333b] text-[#dfebf3]"
              : "border-[#303940] bg-[#1a2025] text-[#acb8c1] hover:bg-[#242d33] hover:text-[#f2f0ef]"
          }`}
          onClick={(event) => {
            event.stopPropagation();
            onToggleWorktreeThreadSwitcher(project.id, worktree.path);
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
          onToggleWorktreePinned(project.id, worktree.path, worktreePinned);
        }}
        disabled={togglingPin || worktreePinBusyPath !== null}
        aria-label={worktreePinned ? "Unpin worktree" : "Pin worktree"}
        title={worktreePinned ? "Unpin worktree" : "Pin worktree"}
      >
        {materialSymbol("push_pin", "text-[13px]", {
          filled: worktreePinned,
        })}
      </button>
      {worktreeState.error ? (
        <div className="px-3 pt-1 text-[11px] text-[#ff6e84]">
          {worktreeState.error}
        </div>
      ) : null}
    </div>
  );
}

type ProjectWorktreeListProps = {
  getWorktreeState: (
    projectId: number,
    worktreePath: string,
  ) => WorktreeNodeState;
  isActiveWorktree: (projectId: number, worktreePath: string) => boolean;
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
  project: RpcProject;
  threadSwitcherEnabled: boolean;
  threadSwitcherOpen: boolean;
  worktrees: RpcWorktree[];
  worktreeDisplayPathByKey: ReadonlyMap<string, string>;
  worktreePinBusyPath: string | null;
};

/**
 * Virtualized list for a project's worktree selector rows.
 */
function ProjectWorktreeList({
  getWorktreeState,
  isActiveWorktree,
  onProjectWorktreeClick,
  onToggleWorktreePinned,
  onToggleWorktreeThreadSwitcher,
  project,
  threadSwitcherEnabled,
  threadSwitcherOpen,
  worktrees,
  worktreeDisplayPathByKey,
  worktreePinBusyPath,
}: ProjectWorktreeListProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: worktrees.length,
    estimateSize: () => PROJECT_WORKTREE_ROW_ESTIMATE_PX,
    getItemKey: (index) => {
      const worktree = worktrees[index];
      return worktree ? worktreeKey(project.id, worktree.path) : index;
    },
    getScrollElement: () => scrollRef.current,
    measureElement: defaultMeasureElement,
    overscan: PROJECT_WORKTREE_LIST_OVERSCAN,
    useAnimationFrameWithResizeObserver: true,
  });
  const virtualRows = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  return (
    <div
      ref={scrollRef}
      className="app-scrollbar max-h-[17rem] overflow-y-auto overscroll-contain pr-1"
    >
      <div
        className="relative w-full"
        style={{
          height: `${totalSize}px`,
        }}
      >
        {virtualRows.map((virtualRow) => {
          const worktree = worktrees[virtualRow.index];
          if (!worktree) {
            return null;
          }

          const worktreePath = worktree.path;

          return (
            <div
              className="absolute left-0 top-0 w-full"
              data-index={virtualRow.index}
              key={virtualRow.key}
              ref={virtualizer.measureElement}
              style={{
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <ProjectWorktreeRow
                activeWorktree={isActiveWorktree(project.id, worktreePath)}
                displayPath={
                  worktreeDisplayPathByKey.get(
                    worktreeKey(project.id, worktreePath),
                  ) ?? worktreePath
                }
                onProjectWorktreeClick={onProjectWorktreeClick}
                onToggleWorktreePinned={onToggleWorktreePinned}
                onToggleWorktreeThreadSwitcher={onToggleWorktreeThreadSwitcher}
                project={project}
                threadSwitcherEnabled={threadSwitcherEnabled}
                threadSwitcherOpen={
                  threadSwitcherOpen &&
                  isActiveWorktree(project.id, worktreePath)
                }
                worktree={worktree}
                worktreePinBusyPath={worktreePinBusyPath}
                worktreeState={getWorktreeState(project.id, worktreePath)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Full prop contract for the sidebar ProjectsPanel.
 */
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
  onRefreshProject: (project: RpcProject, expanded: boolean) => Promise<void>;
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
  selectedProjectId: number | null;
  supportsTildePath: boolean;
  sidebarActionButtonClass: string;
  threadSwitcherEnabled: boolean;
  threadSwitcherOpen: boolean;
  worktreePinBusyPath: string | null;
  worktreeDisplayPathByKey: ReadonlyMap<string, string>;
  worktreeSearchTextByKey: ReadonlyMap<string, string>;
};

/**
 * Sidebar section for project/worktree management:
 * - add-project form + directory autocomplete
 * - expandable project trees with a single virtualized worktree list per project
 * - project-local worktree rows with thread-switch affordances
 */
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
  onRefreshProject,
  onSelectDirectorySuggestion,
  onSubmitAddProject,
  onToggleAddProjectForm,
  onToggleWorktreePinned,
  onToggleWorktreeThreadSwitcher,
  selectedProjectId,
  sidebarActionButtonClass,
  supportsTildePath,
  threadSwitcherEnabled,
  threadSwitcherOpen,
  worktreePinBusyPath,
  worktreeDisplayPathByKey,
  worktreeSearchTextByKey,
}: ProjectsPanelProps) {
  const projectsOpen = useProjectsPanelOpen();
  const openProjectPaths = useOpenProjectPaths();
  const projectWorktreeDataById = useMemo(() => {
    return deriveProjectsPanelWorktreeData(
      filteredProjects,
      (projectId) => projectStateWorktrees(getProjectState(projectId)),
      normalizedSidebarSearchQuery,
      worktreeSearchTextByKey,
    );
  }, [
    filteredProjects,
    getProjectState,
    normalizedSidebarSearchQuery,
    worktreeSearchTextByKey,
  ]);

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
                  Add a repo by its root folder path.
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
            {filteredProjects.length === 0 ? (
              <div className="bg-[#151515] px-3 py-2.5 text-[13px] text-[#a7a7a7]">
                {normalizedSidebarSearchQuery
                  ? "No matching projects."
                  : "No projects in database. Use + to add a project folder."}
              </div>
            ) : (
              filteredProjects.map((project) => {
                const state = getProjectState(project.id);
                const visibleWorktrees =
                  projectWorktreeDataById.get(project.id)?.visibleWorktrees ??
                  [];
                const projectTreeOpen = openProjectPaths.has(project.path);
                const isActive = selectedProjectId === project.id;
                const showWorktrees =
                  projectTreeOpen || Boolean(normalizedSidebarSearchQuery);

                return (
                  <div className="space-y-1" key={project.id}>
                    <div className="group/project flex items-center gap-2">
                      <button
                        type="button"
                        className={`min-w-0 flex-1 px-3 py-2 text-left transition-colors ${
                          isActive
                            ? "bg-[#181f22] text-[#f2f0ef] shadow-[inset_3px_0_0_0_#7aa5c4]"
                            : "text-[#d7d7d7] hover:bg-[#171a1b]"
                        }`}
                        onClick={() => {
                          const nextOpen = !projectTreeOpen;
                          void onRefreshProject(project, nextOpen);
                        }}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          onOpenProjectActionMenu(
                            project,
                            event.clientX + 6,
                            event.clientY + 6,
                          );
                        }}
                      >
                        <div className="flex items-center gap-2.5">
                          <span
                            className={`flex h-7 w-7 shrink-0 items-center justify-center ${
                              isActive
                                ? "bg-[#1f313c] text-[#bdd5e6]"
                                : "bg-[#151a1c] text-[#8ca6b9]"
                            }`}
                          >
                            {materialSymbol(
                              showWorktrees ? "folder_open" : "folder",
                              "text-[16px]",
                            )}
                          </span>
                          <div className="min-w-0 flex-1 truncate text-[14px] font-medium">
                            {project.name}
                          </div>
                          <div className="flex shrink-0 items-center">
                            <span className="text-[#62737e]">
                              {materialSymbol(
                                projectTreeOpen
                                  ? "expand_more"
                                  : "chevron_right",
                                "text-[17px]",
                              )}
                            </span>
                          </div>
                        </div>
                      </button>
                      <button
                        type="button"
                        className={`${sidebarActionButtonClass} ${
                          isActive
                            ? "opacity-100"
                            : "pointer-events-none opacity-0 group-hover/project:pointer-events-auto group-hover/project:opacity-100 group-focus-within/project:pointer-events-auto group-focus-within/project:opacity-100"
                        }`}
                        onClick={(event) => {
                          event.stopPropagation();
                          const rect =
                            event.currentTarget.getBoundingClientRect();
                          onOpenProjectActionMenu(
                            project,
                            rect.right + 8,
                            rect.bottom + 6,
                          );
                        }}
                        aria-label={`Project actions for ${project.name}`}
                      >
                        {materialSymbol("menu", "text-[14px]")}
                      </button>
                    </div>

                    {showWorktrees ? (
                      <div className="ml-4 border-l border-[#1f262a] pl-3">
                        <div className="space-y-1">
                          {state.loadingWorktrees ? (
                            <div className="px-3 py-1 text-xs text-[#8f9aa2]">
                              Loading worktrees...
                            </div>
                          ) : null}
                          {state.error ? (
                            <div className="bg-[#2c1117] px-3 py-2 text-xs text-[#ff9db0]">
                              {state.error}
                            </div>
                          ) : null}
                          {visibleWorktrees.length === 0 ? (
                            <div className="bg-[#141516] px-3 py-2 text-xs text-[#8f8d8b]">
                              {normalizedSidebarSearchQuery
                                ? "No matching worktrees."
                                : "No worktrees found."}
                            </div>
                          ) : null}
                          {visibleWorktrees.length > 0 ? (
                            <ProjectWorktreeList
                              getWorktreeState={getWorktreeState}
                              isActiveWorktree={isActiveWorktree}
                              onProjectWorktreeClick={onProjectWorktreeClick}
                              onToggleWorktreePinned={onToggleWorktreePinned}
                              onToggleWorktreeThreadSwitcher={
                                onToggleWorktreeThreadSwitcher
                              }
                              project={project}
                              threadSwitcherEnabled={threadSwitcherEnabled}
                              threadSwitcherOpen={threadSwitcherOpen}
                              worktrees={visibleWorktrees}
                              worktreeDisplayPathByKey={
                                worktreeDisplayPathByKey
                              }
                              worktreePinBusyPath={worktreePinBusyPath}
                            />
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
});
