/**
 * @file src/bun/plugin/network-allowlist.ts
 * @description URL allowlist pattern compilation and matching for Plugin System v1 network fetches.
 */

import { containsGlobPattern, globSegmentsMatch } from "./glob-match";

const FETCH_NETWORK_PROTOCOLS = new Set(["http:", "https:"]);
const WEBSOCKET_NETWORK_PROTOCOLS = new Set(["ws:", "wss:"]);
const SCHEME_PREFIX_PATTERN = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;

export type CompiledPluginNetworkAllowPattern = {
  allDomains: boolean;
  host: string;
  pathname: string;
  protocol: "http:" | "https:" | "ws:" | "wss:";
  source: string;
};

export type PluginNetworkAllowlistCompileIssueCode =
  | "credentialed_network_allow_pattern"
  | "invalid_network_allow_pattern"
  | "network_https_required"
  | "unsafe_network_all_domain_required";

export type PluginNetworkAllowlistCompileIssue = {
  code: PluginNetworkAllowlistCompileIssueCode;
  index: number;
  message: string;
  pattern: string;
};

export type PluginNetworkAllowlistCompileResult = {
  issues: PluginNetworkAllowlistCompileIssue[];
  patterns: CompiledPluginNetworkAllowPattern[];
};

export type PluginNetworkAllowlistMatchFailureCode =
  | "credentialed_network_url"
  | "invalid_network_url"
  | "network_url_not_allowed";

export type PluginNetworkAllowlistMatchResult =
  | {
      allowed: true;
      pattern: CompiledPluginNetworkAllowPattern;
      url: URL;
    }
  | {
      allowed: false;
      code: PluginNetworkAllowlistMatchFailureCode;
      message: string;
      url?: URL;
    };

export class PluginNetworkAllowlistError extends Error {
  readonly code: PluginNetworkAllowlistMatchFailureCode;
  readonly url: string;

  constructor(input: {
    code: PluginNetworkAllowlistMatchFailureCode;
    message: string;
    url: string;
  }) {
    super(input.message);
    this.name = "PluginNetworkAllowlistError";
    this.code = input.code;
    this.url = input.url;
  }
}

function patternWithDefaultProtocol(
  pattern: string,
  defaultProtocol: "https" | "wss",
): string {
  if (SCHEME_PREFIX_PATTERN.test(pattern)) {
    return pattern;
  }
  if (pattern.startsWith("//")) {
    return `${defaultProtocol}:${pattern}`;
  }
  return `${defaultProtocol}://${pattern}`;
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function pathnameSegments(pathname: string): string[] {
  const withoutLeadingSlash = pathname.startsWith("/")
    ? pathname.slice(1)
    : pathname;
  if (withoutLeadingSlash === "") {
    return [];
  }
  return withoutLeadingSlash.split("/");
}

function pathnameMatchesPattern(patternPathname: string, pathname: string) {
  if (!containsGlobPattern(patternPathname)) {
    return patternPathname === pathname;
  }
  return globSegmentsMatch(
    pathnameSegments(patternPathname),
    pathnameSegments(pathname),
  );
}

function isAllDomainHostPattern(hostname: string): boolean {
  return hostname === "*" || hostname === "**";
}

function allDomainPort(host: string): string | null {
  const match = /^(?:\*|\*\*):(\d+)$/u.exec(host);
  return match?.[1] ?? null;
}

function effectiveUrlPort(url: URL): string {
  if (url.port) {
    return url.port;
  }
  if (url.protocol === "https:" || url.protocol === "wss:") {
    return "443";
  }
  if (url.protocol === "http:" || url.protocol === "ws:") {
    return "80";
  }
  return "";
}

function hostMatchesPattern(
  pattern: CompiledPluginNetworkAllowPattern,
  url: URL,
): boolean {
  if (!pattern.allDomains) {
    return pattern.host === url.host.toLowerCase();
  }
  const requiredPort = allDomainPort(pattern.host);
  return requiredPort === null || requiredPort === effectiveUrlPort(url);
}

export function compilePluginNetworkAllowlist(input: {
  allowUnsafeAllDomains?: boolean;
  enforceHttps?: boolean;
  kind?: "fetch" | "websocket";
  patterns: readonly string[];
}): PluginNetworkAllowlistCompileResult {
  const issues: PluginNetworkAllowlistCompileIssue[] = [];
  const patterns: CompiledPluginNetworkAllowPattern[] = [];
  const enforceHttps = input.enforceHttps ?? true;
  const kind = input.kind ?? "fetch";
  const allowedProtocols =
    kind === "websocket"
      ? WEBSOCKET_NETWORK_PROTOCOLS
      : FETCH_NETWORK_PROTOCOLS;
  const defaultProtocol = kind === "websocket" ? "wss" : "https";
  const secureProtocol = kind === "websocket" ? "wss:" : "https:";

  for (const [index, pattern] of input.patterns.entries()) {
    const url = parseUrl(patternWithDefaultProtocol(pattern, defaultProtocol));
    if (url === null) {
      issues.push({
        code: "invalid_network_allow_pattern",
        index,
        message: "Expected an http(s) URL pattern with a valid host.",
        pattern,
      });
      continue;
    }

    let hasBlockingIssue = false;
    if (!allowedProtocols.has(url.protocol)) {
      issues.push({
        code: "invalid_network_allow_pattern",
        index,
        message:
          kind === "websocket"
            ? "Expected a ws or wss URL pattern."
            : "Expected an http or https URL pattern.",
        pattern,
      });
      hasBlockingIssue = true;
    }
    if (url.username || url.password) {
      issues.push({
        code: "credentialed_network_allow_pattern",
        index,
        message: "URL allow patterns must not include credentials.",
        pattern,
      });
      hasBlockingIssue = true;
    }
    const allDomains = isAllDomainHostPattern(url.hostname);
    if (!url.hostname || (containsGlobPattern(url.hostname) && !allDomains)) {
      issues.push({
        code: "invalid_network_allow_pattern",
        index,
        message:
          "URL allow patterns must include a valid literal host, or use https://**/** with the unsafe permission for all-domain access.",
        pattern,
      });
      hasBlockingIssue = true;
    }
    if (allDomains && input.allowUnsafeAllDomains !== true) {
      issues.push({
        code: "unsafe_network_all_domain_required",
        index,
        message:
          "All-domain network allow patterns require the plugin to declare the unsafe permission.",
        pattern,
      });
      hasBlockingIssue = true;
    }
    if (enforceHttps && url.protocol !== secureProtocol) {
      issues.push({
        code: "network_https_required",
        index,
        message:
          kind === "websocket"
            ? "network.enforceHttps defaults to true; use wss URL patterns or set enforceHttps to false explicitly."
            : "network.enforceHttps defaults to true; use https URL patterns or set enforceHttps to false explicitly.",
        pattern,
      });
      hasBlockingIssue = true;
    }

    if (!hasBlockingIssue) {
      patterns.push({
        allDomains,
        host: url.host.toLowerCase(),
        pathname: url.pathname,
        protocol: url.protocol as "http:" | "https:" | "ws:" | "wss:",
        source: pattern,
      });
    }
  }

  return { issues, patterns };
}

export function matchPluginNetworkAllowlist(
  allowlist: readonly CompiledPluginNetworkAllowPattern[],
  requestUrl: string | URL,
): PluginNetworkAllowlistMatchResult {
  const rawUrl = requestUrl.toString();
  const url = parseUrl(rawUrl);
  const supportedProtocols = new Set([
    ...FETCH_NETWORK_PROTOCOLS,
    ...WEBSOCKET_NETWORK_PROTOCOLS,
  ]);
  if (url === null || !supportedProtocols.has(url.protocol) || !url.hostname) {
    return {
      allowed: false,
      code: "invalid_network_url",
      message: "Expected an http(s) or ws(s) URL with a valid host.",
    };
  }
  if (url.username || url.password) {
    return {
      allowed: false,
      code: "credentialed_network_url",
      message: "Plugin fetch URLs must not include credentials.",
      url,
    };
  }

  const match = allowlist.find(
    (pattern) =>
      pattern.protocol === url.protocol &&
      hostMatchesPattern(pattern, url) &&
      pathnameMatchesPattern(pattern.pathname, url.pathname),
  );
  if (match) {
    return { allowed: true, pattern: match, url };
  }

  return {
    allowed: false,
    code: "network_url_not_allowed",
    message: "Plugin fetch URL is not covered by network.allow.",
    url,
  };
}

export function assertPluginNetworkUrlAllowed(
  allowlist: readonly CompiledPluginNetworkAllowPattern[],
  requestUrl: string | URL,
): URL {
  const result = matchPluginNetworkAllowlist(allowlist, requestUrl);
  if (result.allowed) {
    return result.url;
  }
  throw new PluginNetworkAllowlistError({
    code: result.code,
    message: result.message,
    url: requestUrl.toString(),
  });
}
