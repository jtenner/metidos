export type SecurityAuditRefreshOptions = {
  projectId?: number | null;
  threadId?: number | null;
};

export type NormalizedSecurityAuditRefreshOptions = {
  projectId: number | null;
  threadId: number | null;
};

export type SecurityAuditRefreshRequest = {
  isLatestRequest: () => boolean;
  options: NormalizedSecurityAuditRefreshOptions;
  requestId: number;
};

type SecurityAuditRefreshRunnerOptions = {
  load: (request: SecurityAuditRefreshRequest) => Promise<void>;
  onLoadingChange?: (loading: boolean) => void;
};

export function normalizeSecurityAuditRefreshOptions(
  options?: SecurityAuditRefreshOptions,
): NormalizedSecurityAuditRefreshOptions {
  return {
    projectId:
      typeof options?.projectId === "number" ? options.projectId : null,
    threadId: typeof options?.threadId === "number" ? options.threadId : null,
  };
}

export function securityAuditRefreshOptionsEqual(
  left: NormalizedSecurityAuditRefreshOptions,
  right: NormalizedSecurityAuditRefreshOptions,
): boolean {
  return left.projectId === right.projectId && left.threadId === right.threadId;
}

/**
 * Serializes security-audit refreshes while allowing later requests to replace
 * any older queued scope before it begins.
 */
export function createSupersedingSecurityAuditRefreshRunner(
  options: SecurityAuditRefreshRunnerOptions,
): {
  request: (refreshOptions?: SecurityAuditRefreshOptions) => Promise<void>;
} {
  let activePromise: Promise<void> | null = null;
  let latestRequestId = 0;
  let latestRequestedOptions = normalizeSecurityAuditRefreshOptions();
  let queuedRequest: SecurityAuditRefreshRequest | null = null;

  const runRefreshes = async (
    initialRequest: SecurityAuditRefreshRequest,
  ): Promise<void> => {
    options.onLoadingChange?.(true);
    try {
      let request = initialRequest;
      while (true) {
        await options.load(request);
        const nextRequest = queuedRequest;
        queuedRequest = null;
        if (
          nextRequest === null ||
          securityAuditRefreshOptionsEqual(nextRequest.options, request.options)
        ) {
          return;
        }
        request = nextRequest;
      }
    } finally {
      options.onLoadingChange?.(false);
    }
  };

  return {
    request: async (
      refreshOptions?: SecurityAuditRefreshOptions,
    ): Promise<void> => {
      const normalizedOptions =
        normalizeSecurityAuditRefreshOptions(refreshOptions);
      latestRequestedOptions = normalizedOptions;
      latestRequestId += 1;
      const nextRequest: SecurityAuditRefreshRequest = {
        isLatestRequest: () =>
          securityAuditRefreshOptionsEqual(
            latestRequestedOptions,
            nextRequest.options,
          ),
        options: normalizedOptions,
        requestId: latestRequestId,
      };

      if (activePromise) {
        queuedRequest = nextRequest;
        return activePromise;
      }

      const nextPromise = runRefreshes(nextRequest).finally(() => {
        if (activePromise === nextPromise) {
          activePromise = null;
        }
      });
      activePromise = nextPromise;
      return nextPromise;
    },
  };
}
