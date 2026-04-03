import { type FormEvent, memo, useMemo } from "react";
import type { RpcProject, RpcWorktree } from "../../bun/rpc-schema";
import { materialSymbol } from "../controls/icons";
import { matchesSearchQuery } from "../controls/search-utils";
import { SidebarSectionHeader } from "../controls/sidebar-section-header";
import {
  setProjectTreeOpen,
  toggleProjectsPanelOpen,
  useOpenProjectPaths,
  useProjectsPanelOpen,
} from "./sidebar-panels-state";
import {
  formatDirectoryPathForInput,
  formatPathForDisplay,
  orderProjectWorktrees,
  type ProjectNodeState,
  shortName,
  type ThreadErrorLevel,
  type WorktreeNodeState,
  worktreeThreadPopoverAnchorId,
} from "./state";

type PinnedWorktreeEntry = {
  project: RpcProject;
  worktree: RpcWorktree;
};

type ProjectWorktreeRowProps = {
  activeWorktree: boolean;
  homeDirectory: string;
  onProjectWorktreeClick: (project: RpcProject, worktreePath: string) => void;
  onToggleWorktreePinned: (
    projectId: number,
    worktreePath: string,
    pinned: boolean,
  ) => void;
  project: RpcProject;
  showProjectName?: boolean;
  supportsTildePath: boolean;
  worktree: RpcWorktree;
  worktreeErrorLevel: ThreadErrorLevel;
  worktreePinBusyPath: string | null;
  worktreeState: WorktreeNodeState;
};

function worktreeMatchesProjectsSearch(
  normalizedSidebarSearchQuery: string,
  project: RpcProject,
  worktree: RpcWorktree,
  homeDirectory: string,
  supportsTildePath: boolean,
): boolean {
  return matchesSearchQuery(
    normalizedSidebarSearchQuery,
    project.name,
    worktree.branch,
    worktree.path,
    shortName(worktree.path),
    formatPathForDisplay(worktree.path, homeDirectory, supportsTildePath),
  );
}

function comparePinnedWorktreeEntries(
  left: PinnedWorktreeEntry,
  right: PinnedWorktreeEntry,
): number {
  const leftPinnedAt = left.worktree.pinnedAt ?? "";
  const rightPinnedAt = right.worktree.pinnedAt ?? "";
  if (leftPinnedAt !== rightPinnedAt) {
    return rightPinnedAt.localeCompare(leftPinnedAt);
  }

  const projectNameOrder = left.project.name.localeCompare(right.project.name);
  if (projectNameOrder !== 0) {
    return projectNameOrder;
  }

  return left.worktree.path.localeCompare(right.worktree.path);
}

function ProjectWorktreeRow({
  activeWorktree,
  homeDirectory,
  onProjectWorktreeClick,
  onToggleWorktreePinned,
  project,
  showProjectName = false,
  supportsTildePath,
  worktree,
  worktreeErrorLevel,
  worktreePinBusyPath,
  worktreeState,
}: ProjectWorktreeRowProps) {
  const worktreePinned = Boolean(worktree.pinnedAt);
  const togglingPin = worktreePinBusyPath === worktree.path;
  const displayPath = formatPathForDisplay(
    worktree.path,
    homeDirectory,
    supportsTildePath,
  );

  return (
    <div className="relative">
      <button
        type="button"
        id={worktreeThreadPopoverAnchorId(project.id, worktree.path)}
        className={`flex w-full min-w-0 items-center gap-2.5 px-2.5 py-1.5 pr-10 text-left transition-colors ${
          activeWorktree
            ? "bg-[#1c2529] text-[#f2f0ef] shadow-[inset_2px_0_0_0_#7aa5c4]"
            : "text-[#cfd1d4] hover:bg-[#14181a]"
        }`}
        onClick={() => {
          onProjectWorktreeClick(project, worktree.path);
        }}
      >
        <span
          className={`flex h-6 w-6 shrink-0 items-center justify-center ${
            activeWorktree
              ? "bg-[#24333b] text-[#bdd5e6]"
              : "bg-[#14181a] text-[#8ca6b9]"
          }`}
        >
          {materialSymbol(
            activeWorktree ? "folder_open" : "folder",
            "text-[14px]",
          )}
        </span>
        <div className="min-w-0 flex-1">
          {showProjectName ? (
            <div className="truncate font-label text-[9px] uppercase tracking-[0.16em] text-[#8ca6b9]">
              {project.name}
            </div>
          ) : null}
          <div
            className={`truncate text-[13px] font-medium leading-4 ${
              showProjectName ? "mt-0.5" : ""
            }`}
            title={shortName(worktree.path)}
          >
            {shortName(worktree.path)}
          </div>
          <div className="mt-0.5 truncate text-[10px] leading-[0.85rem] text-[#8f9aa2]">
            {showProjectName ? (
              `${worktree.branch ?? "Primary"} · ${displayPath}`
            ) : (
              <>
                {worktree.branch ?? "Primary"} · {displayPath}
              </>
            )}
          </div>
        </div>
        <span
          className={`absolute right-10 top-1/2 h-1.5 w-1.5 -translate-y-1/2 ${
            worktreeErrorLevel === "unread"
              ? "bg-[#ff304f]"
              : worktreeErrorLevel === "failed"
                ? "bg-[#8f4956]"
                : worktreeErrorLevel === "stopped"
                  ? "bg-[#b98a3a]"
                  : "bg-transparent"
          }`}
        />
      </button>
      <button
        type="button"
        className={`absolute right-2 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center border transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
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
  onRefreshProject: (project: RpcProject, expanded: boolean) => void;
  onSelectDirectorySuggestion: (directory: string) => void;
  onSubmitAddProject: (event: FormEvent<HTMLFormElement>) => void;
  onToggleAddProjectForm: () => void;
  onToggleWorktreePinned: (
    projectId: number,
    worktreePath: string,
    pinned: boolean,
  ) => void;
  projectThreadErrorLevel: (projectId: number) => ThreadErrorLevel;
  selectedProjectId: number | null;
  supportsTildePath: boolean;
  sidebarActionButtonClass: string;
  worktreePinBusyPath: string | null;
  worktreeThreadErrorLevel: (
    projectId: number,
    worktreePath: string,
  ) => ThreadErrorLevel;
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
  onRefreshProject,
  onSelectDirectorySuggestion,
  onSubmitAddProject,
  onToggleAddProjectForm,
  onToggleWorktreePinned,
  projectThreadErrorLevel,
  selectedProjectId,
  sidebarActionButtonClass,
  supportsTildePath,
  worktreePinBusyPath,
  worktreeThreadErrorLevel,
}: ProjectsPanelProps) {
  const projectsOpen = useProjectsPanelOpen();
  const openProjectPaths = useOpenProjectPaths();
  const pinnedWorktreeEntries = useMemo(() => {
    return filteredProjects
      .flatMap((project) =>
        orderProjectWorktrees(project, getProjectState(project.id).worktrees)
          .filter(
            (worktree) =>
              worktree.pinnedAt !== null &&
              worktreeMatchesProjectsSearch(
                normalizedSidebarSearchQuery,
                project,
                worktree,
                homeDirectory,
                supportsTildePath,
              ),
          )
          .map((worktree) => ({
            project,
            worktree,
          })),
      )
      .sort(comparePinnedWorktreeEntries);
  }, [
    filteredProjects,
    getProjectState,
    homeDirectory,
    normalizedSidebarSearchQuery,
    supportsTildePath,
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
          {pinnedWorktreeEntries.length > 0 ? (
            <div className="space-y-1">
              <div className="px-3 pb-1 font-label text-[9px] uppercase tracking-[0.18em] text-[#8ca6b9]">
                Pinned
              </div>
              <div className="app-scrollbar max-h-[17rem] overflow-y-auto overscroll-contain pr-1">
                <div className="space-y-1">
                  {pinnedWorktreeEntries.map(({ project, worktree }) => (
                    <ProjectWorktreeRow
                      key={`${project.id}:${worktree.path}`}
                      activeWorktree={isActiveWorktree(
                        project.id,
                        worktree.path,
                      )}
                      homeDirectory={homeDirectory}
                      onProjectWorktreeClick={onProjectWorktreeClick}
                      onToggleWorktreePinned={onToggleWorktreePinned}
                      project={project}
                      showProjectName
                      supportsTildePath={supportsTildePath}
                      worktree={worktree}
                      worktreeErrorLevel={worktreeThreadErrorLevel(
                        project.id,
                        worktree.path,
                      )}
                      worktreePinBusyPath={worktreePinBusyPath}
                      worktreeState={getWorktreeState(
                        project.id,
                        worktree.path,
                      )}
                    />
                  ))}
                </div>
              </div>
            </div>
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
                const projectTreeOpen = openProjectPaths.has(project.path);
                const isActive = selectedProjectId === project.id;
                const projectErrorLevel = projectThreadErrorLevel(project.id);
                const orderedWorktrees = orderProjectWorktrees(
                  project,
                  state.worktrees,
                );
                const visiblePinnedWorktrees = orderedWorktrees.filter(
                  (worktree) =>
                    worktree.pinnedAt !== null &&
                    worktreeMatchesProjectsSearch(
                      normalizedSidebarSearchQuery,
                      project,
                      worktree,
                      homeDirectory,
                      supportsTildePath,
                    ),
                );
                const visibleWorktrees = orderedWorktrees.filter(
                  (worktree) =>
                    worktree.pinnedAt === null &&
                    worktreeMatchesProjectsSearch(
                      normalizedSidebarSearchQuery,
                      project,
                      worktree,
                      homeDirectory,
                      supportsTildePath,
                    ),
                );
                const showWorktrees =
                  projectTreeOpen || Boolean(normalizedSidebarSearchQuery);
                const projectIndicatorClass = isActive
                  ? "bg-[#7aa5c4]"
                  : projectErrorLevel === "unread"
                    ? "bg-[#ff304f]"
                    : projectErrorLevel === "failed"
                      ? "bg-[#8f4956]"
                      : projectErrorLevel === "stopped"
                        ? "bg-[#b98a3a]"
                        : "bg-[#5f5f5f]";

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
                          setProjectTreeOpen(project.path, nextOpen);
                          onRefreshProject(project, nextOpen);
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
                          <div className="flex shrink-0 items-center gap-2">
                            <span
                              className={`h-1.5 w-1.5 ${projectIndicatorClass}`}
                            />
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
                                ? visiblePinnedWorktrees.length > 0
                                  ? "Matching pinned worktrees are listed above."
                                  : "No matching worktrees."
                                : orderedWorktrees.some(
                                      (worktree) => worktree.pinnedAt !== null,
                                    )
                                  ? "Pinned worktrees are listed above."
                                  : "No worktrees found."}
                            </div>
                          ) : null}
                          {visibleWorktrees.length > 0 ? (
                            <div className="app-scrollbar max-h-[17rem] overflow-y-auto overscroll-contain pr-1">
                              <div className="space-y-1">
                                {visibleWorktrees.map((worktree) => {
                                  return (
                                    <ProjectWorktreeRow
                                      key={worktree.path}
                                      activeWorktree={isActiveWorktree(
                                        project.id,
                                        worktree.path,
                                      )}
                                      homeDirectory={homeDirectory}
                                      onProjectWorktreeClick={
                                        onProjectWorktreeClick
                                      }
                                      onToggleWorktreePinned={
                                        onToggleWorktreePinned
                                      }
                                      project={project}
                                      supportsTildePath={supportsTildePath}
                                      worktree={worktree}
                                      worktreeErrorLevel={worktreeThreadErrorLevel(
                                        project.id,
                                        worktree.path,
                                      )}
                                      worktreePinBusyPath={worktreePinBusyPath}
                                      worktreeState={getWorktreeState(
                                        project.id,
                                        worktree.path,
                                      )}
                                    />
                                  );
                                })}
                              </div>
                            </div>
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
