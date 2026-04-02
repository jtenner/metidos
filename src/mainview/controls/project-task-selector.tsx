import { type JSX, useId } from "react";
import type { RpcProjectTask } from "../../bun/rpc-schema";
import { DropdownControl } from "./dropdown";
import { materialSymbol } from "./icons";

type ProjectTaskSelectorProps = {
  disabled: boolean;
  loading: boolean;
  onSelect: (task: RpcProjectTask) => void;
  tasks: RpcProjectTask[];
  variant: "desktop" | "mobile";
};

export function ProjectTaskSelector({
  disabled,
  loading,
  onSelect,
  tasks,
  variant,
}: ProjectTaskSelectorProps): JSX.Element {
  const noTasksAvailable = !loading && tasks.length === 0;
  const unavailable = disabled || noTasksAvailable;
  const noTasksHintId = useId();
  const buttonLabel = loading
    ? "Loading Tasks"
    : tasks.length > 0
      ? `Tasks (${tasks.length})`
      : "Tasks";

  const taskMetaText = (task: RpcProjectTask): string | null => {
    if (task.kind === "script") {
      return task.command?.trim()
        ? `${task.path} · ${task.command}`
        : task.path;
    }
    return task.path !== task.title ? task.path : null;
  };

  return (
    <DropdownControl
      canOpen={!unavailable}
      disabled={disabled}
      rootClassName={noTasksAvailable ? "group relative" : "relative"}
      renderButton={({ open, toggle }) => (
        <>
          <button
            type="button"
            className={`flex items-center gap-2 transition-colors ${
              variant === "desktop"
                ? unavailable
                  ? "h-7 gap-1.5 bg-[#191a1a] px-2.5"
                  : "h-7 gap-1.5 bg-[#191a1a] px-2.5 hover:bg-[#262626]"
                : unavailable
                  ? "h-10 w-full justify-between border border-[#424e57] bg-[#1d2022] px-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
                  : "h-10 w-full justify-between border border-[#424e57] bg-[#1d2022] px-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] hover:bg-[#262b2f]"
            } ${unavailable ? "cursor-not-allowed opacity-60" : ""}`}
            onClick={toggle}
            disabled={disabled}
            aria-disabled={unavailable}
            aria-describedby={noTasksAvailable ? noTasksHintId : undefined}
            aria-expanded={open}
            aria-haspopup="menu"
          >
            {materialSymbol(
              "checklist",
              variant === "desktop"
                ? "text-[#bdd5e6] text-[16px]"
                : "text-on-surface-variant text-sm",
            )}
            <span
              className={`font-label uppercase ${
                variant === "desktop"
                  ? "text-[10px] font-bold leading-none text-[#f2f0ef]"
                  : "text-[10px] leading-none tracking-widest text-[#f2f0ef]"
              }`}
            >
              {buttonLabel}
            </span>
          </button>
          {noTasksAvailable ? (
            <span className="sr-only" id={noTasksHintId}>
              No project tasks found.
            </span>
          ) : null}
          {variant === "desktop" && noTasksAvailable ? (
            <div className="pointer-events-none absolute bottom-[calc(100%+0.5rem)] left-1/2 z-50 -translate-x-1/2 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
              <div className="whitespace-nowrap border border-[#3c4c58] bg-[#15191b] px-3 py-2 text-xs text-[#dfebf3] shadow-[0_18px_38px_rgba(0,0,0,0.42)]">
                No tasks found.
              </div>
            </div>
          ) : null}
        </>
      )}
      renderPanel={({ close }) => (
        <div
          className={`absolute bottom-[calc(100%+0.5rem)] z-40 overflow-hidden border shadow-[0_18px_38px_rgba(0,0,0,0.42)] ${
            variant === "desktop"
              ? "left-0 min-w-[18rem] border-[#3c4c58] bg-[#15191b]"
              : "right-0 w-[calc(100vw-2rem)] max-w-[18rem] border-[#445058] bg-[#171b1d]"
          }`}
        >
          <div className="border-b border-[#3c4c58] px-3 py-2 font-label text-[9px] uppercase tracking-[0.18em] text-[#92a7b6]">
            Project Tasks
          </div>
          <div className="max-h-80 overflow-y-auto py-2 hide-scrollbar">
            {loading ? (
              <div className="px-4 py-4 text-xs text-[#8f9aa2]">
                Loading tasks...
              </div>
            ) : tasks.length === 0 ? (
              <div className="px-4 py-4 text-xs text-[#8f9aa2]">
                No project tasks found.
              </div>
            ) : (
              tasks.map((task) => (
                <button
                  key={task.id}
                  type="button"
                  className="flex w-full items-start gap-3 px-3 py-2 text-left transition-colors hover:bg-[#1e2428]"
                  onClick={() => {
                    close();
                    onSelect(task);
                  }}
                >
                  <span className="mt-0.5 shrink-0 text-[#bdd5e6]">
                    {materialSymbol(
                      task.kind === "script" ? "terminal" : "task_alt",
                      "text-[16px]",
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-label text-[10px] font-bold uppercase tracking-wider text-[#f2f0ef]">
                      {task.title}
                    </span>
                    {taskMetaText(task) ? (
                      <span className="mt-1 block truncate text-[11px] leading-4 text-[#a7b7c2]">
                        {taskMetaText(task)}
                      </span>
                    ) : null}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    />
  );
}
