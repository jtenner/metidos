import type {
  RpcPluginAccessGroupOption,
  RpcThreadPermissionDescriptor,
} from "./plugin";
import type {
  RpcHomeDirectoryResult,
  RpcProject,
  RpcWorktree,
} from "./project-worktree";
import type { RpcModelCatalog } from "./model-catalog";
import type { RpcThread, RpcThreadDetail } from "./thread";

export type RpcAppBootstrapHint = {
  threadIdHint?: number | null;
  selectedProjectId?: number | null;
  selectedWorktreePath?: string | null;
};

export type RpcMainviewHtmlBootstrapComponent =
  | "homeDirectory"
  | "modelCatalogDefaults"
  | "modelCatalogModels"
  | "pluginAccessGroups"
  | "threadPermissionDescriptors"
  | "projects"
  | "pinnedWorktrees"
  | "threadSummaries"
  | "threadDetails"
  | "filesystemAndGitDetails"
  | "secretsAndSettingsValues";

export type RpcMainviewHtmlBootstrapFieldPolicy =
  | "inline"
  | "summarized"
  | "deferred"
  | "forbidden";

export type RpcMainviewHtmlBootstrapFieldContract = {
  component: RpcMainviewHtmlBootstrapComponent;
  policy: RpcMainviewHtmlBootstrapFieldPolicy;
  description: string;
  targetBytes?: number;
  maxBytes?: number;
};

export type RpcMainviewHtmlBootstrapContract = {
  schema: "metidos.mainview-html-bootstrap/v1";
  maxPayloadBytes: number;
  staleAfterMs: number;
  modelCatalogRefresh: "defaults-inline-models-inline-refresh-after-first-paint";
  fallback: {
    missing: "call-getAppBootstrap";
    schemaMismatch: "discard-and-call-getAppBootstrap";
    stale: "hydrate-then-refresh";
    oversize: "omit-inline-bootstrap";
  };
  fields: RpcMainviewHtmlBootstrapFieldContract[];
};

export const MAINVIEW_HTML_BOOTSTRAP_CONTRACT = {
  schema: "metidos.mainview-html-bootstrap/v1",
  maxPayloadBytes: 256_000,
  staleAfterMs: 30_000,
  modelCatalogRefresh:
    "defaults-inline-models-inline-refresh-after-first-paint",
  fallback: {
    missing: "call-getAppBootstrap",
    schemaMismatch: "discard-and-call-getAppBootstrap",
    stale: "hydrate-then-refresh",
    oversize: "omit-inline-bootstrap",
  },
  fields: [
    {
      component: "homeDirectory",
      policy: "inline",
      description:
        "Small authenticated shell primitive used before first paint.",
      targetBytes: 256,
      maxBytes: 1_024,
    },
    {
      component: "modelCatalogDefaults",
      policy: "inline",
      description:
        "Default model and reasoning effort needed to render composer state.",
      targetBytes: 512,
      maxBytes: 2_048,
    },
    {
      component: "modelCatalogModels",
      policy: "summarized",
      description:
        "Current model options may be inlined for initial controls, but clients must refresh the catalog after first paint.",
      targetBytes: 48_000,
      maxBytes: 96_000,
    },
    {
      component: "pluginAccessGroups",
      policy: "inline",
      description:
        "Permission group labels required by thread access controls.",
      targetBytes: 8_000,
      maxBytes: 24_000,
    },
    {
      component: "threadPermissionDescriptors",
      policy: "inline",
      description:
        "Core and plugin permission descriptors; settings values and secrets are forbidden.",
      targetBytes: 16_000,
      maxBytes: 48_000,
    },
    {
      component: "projects",
      policy: "summarized",
      description:
        "Visible project records only; filesystem scans and worktree details stay deferred.",
      targetBytes: 32_000,
      maxBytes: 64_000,
    },
    {
      component: "pinnedWorktrees",
      policy: "summarized",
      description:
        "Pinned worktree metadata without git history, diff, or file contents.",
      targetBytes: 16_000,
      maxBytes: 32_000,
    },
    {
      component: "threadSummaries",
      policy: "summarized",
      description:
        "Thread list rows only; transcripts, screenshots, tool outputs, and diffs are forbidden inline.",
      targetBytes: 48_000,
      maxBytes: 96_000,
    },
    {
      component: "threadDetails",
      policy: "forbidden",
      description:
        "Thread transcripts, screenshots, tool outputs, command output, and file-change diffs must stay behind getThread.",
      maxBytes: 0,
    },
    {
      component: "filesystemAndGitDetails",
      policy: "deferred",
      description:
        "Filesystem scans, git history, diff contents, and worktree refresh data are loaded by focused RPCs after hydration.",
      maxBytes: 0,
    },
    {
      component: "secretsAndSettingsValues",
      policy: "forbidden",
      description:
        "Secrets, provider credentials, plugin settings values, recovery codes, and auth material are never inlined.",
      maxBytes: 0,
    },
  ],
} satisfies RpcMainviewHtmlBootstrapContract;

export type RpcAppBootstrapPinnedWorktree = {
  projectId: number;
  worktree: RpcWorktree;
};

export type RpcAppBootstrapResult = {
  homeDirectory: RpcHomeDirectoryResult;
  modelCatalog: RpcModelCatalog;
  pluginAccessGroups: RpcPluginAccessGroupOption[];
  threadPermissionDescriptors: RpcThreadPermissionDescriptor[];
  projects: RpcProject[];
  pinnedWorktrees: RpcAppBootstrapPinnedWorktree[];
  threadDetail: RpcThreadDetail | null;
  threads: RpcThread[];
};
