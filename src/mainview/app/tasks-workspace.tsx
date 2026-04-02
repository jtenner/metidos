import type { JSX } from "react";
import type { RpcProject, RpcProjectTask } from "../../bun/rpc-schema";
import { materialSymbol } from "../controls/icons";
import { formatPathForDisplay } from "./state";

type TasksWorkspaceProps = {
  activeSelectedWorktreeOpened: boolean;
  activeSelectedWorktreePath: string | null;
  homeDirectory: string;
  isLoadingProjectTasks: boolean;
  onRunTask: (task: RpcProjectTask) => void;
  runDisabled: boolean;
  selectedProject: RpcProject | null;
  supportsTildePath: boolean;
  taskControlError: string;
  tasks: RpcProjectTask[];
  variant: "desktop" | "mobile";
};

function taskMetaText(task: RpcProjectTask): string | null {
  if (task.kind === "script") {
    return task.command?.trim() ? `${task.path} · ${task.command}` : task.path;
  }
  return task.path !== task.title ? task.path : null;
}

export function TasksWorkspace({
  activeSelectedWorktreeOpened,
  activeSelectedWorktreePath,
  homeDirectory,
  isLoadingProjectTasks,
  onRunTask,
  runDisabled,
  selectedProject,
  supportsTildePath,
  taskControlError,
  tasks,
  variant,
}: TasksWorkspaceProps): JSX.Element {
  const mobile = variant === "mobile";
  const title = selectedProject ? "Project Tasks" : "No project selected";
  const subtitle = selectedProject
    ? formatPathForDisplay(
        activeSelectedWorktreePath ?? "",
        homeDirectory,
        supportsTildePath,
      )
    : "Select a project worktree to view tasks.";

  const content =
    !selectedProject || !activeSelectedWorktreePath ? (
      <div className="border border-[#252f36] bg-[#12181c] px-4 py-4 text-sm text-[#8f9aa2]">
        Select a project worktree first.
      </div>
    ) : !activeSelectedWorktreeOpened ? (
      <div className="border border-[#252f36] bg-[#12181c] px-4 py-4 text-sm text-[#8f9aa2]">
        Open this worktree from the Projects panel to run its tasks.
      </div>
    ) : isLoadingProjectTasks ? (
      <div className="border border-[#283239] bg-[#151b20] px-4 py-4 text-sm text-[#d4e4ef]">
        Loading project tasks...
      </div>
    ) : tasks.length === 0 ? (
      <div className="border border-[#31404a] bg-[#12181c] px-4 py-4 text-sm text-[#cfe0eb]">
        No project tasks found in this worktree.
      </div>
    ) : (
      <div className="overflow-hidden border border-[#252f36] bg-[#0f1417]">
        <div className="divide-y divide-[#202930]">
          {tasks.map((task) => (
            <button
              key={task.id}
              type="button"
              className="flex w-full items-start gap-3 px-4 py-4 text-left transition-colors hover:bg-[#151d22] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={runDisabled}
              onClick={() => {
                onRunTask(task);
              }}
            >
              <span className="mt-0.5 shrink-0 text-[#bdd5e6]">
                {materialSymbol(
                  task.kind === "script" ? "terminal" : "task_alt",
                  "text-[18px]",
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-label text-[10px] font-bold uppercase tracking-[0.16em] text-[#f2f0ef]">
                  {task.title}
                </span>
                {taskMetaText(task) ? (
                  <span className="mt-2 block text-sm leading-5 text-[#a7b7c2]">
                    {taskMetaText(task)}
                  </span>
                ) : null}
              </span>
              <span className="shrink-0 text-[#6f7b83]">
                {materialSymbol("arrow_forward", "text-base")}
              </span>
            </button>
          ))}
        </div>
      </div>
    );

  return (
    <div
      className={
        mobile
          ? "flex min-h-0 flex-1 flex-col gap-4 pt-6"
          : "flex min-h-0 flex-1 flex-col overflow-hidden"
      }
    >
      <div
        className={
          mobile
            ? "border border-[#252f36] bg-[#12181c] px-4 py-4"
            : "border-b border-[#262626] bg-[#101417] px-6 py-5"
        }
      >
        <div className="font-label text-[10px] uppercase tracking-[0.18em] text-[#8fb5cd]">
          Tasks
        </div>
        <div className="mt-2 text-sm font-semibold text-[#f2f0ef]">{title}</div>
        <div className="mt-1 text-xs text-[#8f9aa2]">{subtitle}</div>
        {taskControlError ? (
          <div className="mt-3 border border-[#5c2030] bg-[#2c1117] px-3 py-2 text-xs text-[#ff9db0]">
            {taskControlError}
          </div>
        ) : null}
      </div>
      <div className={mobile ? "min-h-0" : "min-h-0 flex-1 px-6 py-6"}>
        {content}
      </div>
    </div>
  );
}
