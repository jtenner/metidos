/**
 * @file src/bun/outbound-url-security.ts
 * @description Shared outbound HTTP(S) URL validation for SSRF-sensitive fetches.
 */

import { lookup } from "node:dns/promises";
import { request as requestHttp } from "node:http";
import { request as requestHttps } from "node:https";
import { isIP } from "node:net";

export type ResolveHostname = (hostname: string) => Promise<string[]>;

export type SafeOutboundHttpUrlOptions = {
  label?: string;
  resolveHostname?: ResolveHostname;
};

export type SafeOutboundFetch = (
  url: URL,
  init?: Partial<
    Pick<RequestInit, "body" | "headers" | "method" | "redirect" | "signal">
  >,
) => Promise<Response>;

type SafeOutboundHttpUrlValidation = {
  resolvedAddress: string;
  url: URL;
};

type NodeLookupOptions = {
  all?: boolean | undefined;
};

type NodeLookupCallback =
  | ((error: Error | null, address: string, family: number) => void)
  | ((
      error: Error | null,
      addresses: Array<{ address: string; family: number }>,
    ) => void);

type OutboundHttpUrlValidationOptions = SafeOutboundHttpUrlOptions & {
  blockedAddressError: string;
  blockedHostnameError: string;
  blockedResolvedAddressError: string;
  isBlockedAddress: (address: string) => boolean;
  isBlockedHostname?: (hostname: string) => boolean;
  rejectLocalhostName: boolean;
};

const BLOCKED_PRIVATE_NETWORK_METADATA_HOSTS = new Set([
  "metadata",
  "metadata.google.internal",
]);

function isBlockedIpv4(hostname: string): boolean {
  // SSRF-safe mode rejects non-public IPv4 space rather than only RFC1918.
  // The blocked set covers wildcard/this-host (0/8), private networks,
  // loopback, link-local metadata-adjacent space, carrier-grade NAT,
  // benchmarking ranges, multicast, reserved future-use, and broadcast space.
  const parts = parseIpv4Address(hostname);
  if (!parts) {
    return true;
  }
  const [first = 0, second = 0] = parts;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 198 && (second === 18 || second === 19)) ||
    first >= 224
  );
}

function parseIpv4Address(hostname: string): number[] | null {
  const parts = hostname.split(".");
  if (parts.length !== 4) {
    return null;
  }
  const parsed = parts.map((part) => Number.parseInt(part, 10));
  if (
    parsed.some(
      (part, index) =>
        Number.isNaN(part) ||
        String(part) !== parts[index] ||
        part < 0 ||
        part > 255,
    )
  ) {
    return null;
  }
  return parsed;
}

function splitIpv6Ipv4Suffix(
  hostname: string,
): { ipv4: string; prefix: string } | null {
  const separatorIndex = hostname.lastIndexOf(":");
  if (separatorIndex < 0) {
    return null;
  }
  const ipv4 = hostname.slice(separatorIndex + 1);
  if (!/^\d+\.\d+\.\d+\.\d+$/u.test(ipv4)) {
    return null;
  }
  return {
    ipv4,
    prefix: hostname.slice(0, separatorIndex + 1),
  };
}

function parseIpv6Hextets(hostname: string): number[] | null {
  const normalized = hostname.toLowerCase();
  const ipv4Suffix = splitIpv6Ipv4Suffix(normalized);
  const ipv4Parts = ipv4Suffix ? parseIpv4Address(ipv4Suffix.ipv4) : null;
  if (ipv4Suffix && !ipv4Parts) {
    return null;
  }

  const withoutIpv4 = ipv4Suffix
    ? `${ipv4Suffix.prefix}${
        ipv4Parts
          ? `${(((ipv4Parts[0] ?? 0) << 8) | (ipv4Parts[1] ?? 0)).toString(16)}:${(((ipv4Parts[2] ?? 0) << 8) | (ipv4Parts[3] ?? 0)).toString(16)}`
          : ""
      }`
    : normalized;
  const doubleColonParts = withoutIpv4.split("::");
  if (doubleColonParts.length > 2) {
    return null;
  }

  const parseSide = (side: string): number[] | null => {
    if (!side) {
      return [];
    }
    const parts = side.split(":");
    if (parts.some((part) => !/^[0-9a-f]{1,4}$/u.test(part))) {
      return null;
    }
    return parts.map((part) => Number.parseInt(part, 16));
  };
  const left = parseSide(doubleColonParts[0] ?? "");
  const right = parseSide(doubleColonParts[1] ?? "");
  if (!left || !right) {
    return null;
  }

  const missing = 8 - left.length - right.length;
  if (doubleColonParts.length === 1) {
    return missing === 0 ? left : null;
  }
  if (missing < 1) {
    return null;
  }
  return [...left, ...Array.from({ length: missing }, () => 0), ...right];
}

function ipv4FromHextets(hextets: number[]): string {
  const first = hextets[6] ?? 0;
  const second = hextets[7] ?? 0;
  return [first >> 8, first & 0xff, second >> 8, second & 0xff].join(".");
}

function isBlockedIpv6(hostname: string): boolean {
  // SSRF-safe mode rejects localhost/unspecified, link-local, unique-local,
  // multicast, 6to4, documentation/IETF protocol assignments, NAT64 well-known
  // prefixes, and IPv4-compatible or IPv4-mapped forms whose embedded IPv4
  // address is blocked. Unknown or malformed IPv6 literals fail closed.
  const hextets = parseIpv6Hextets(hostname);
  if (!hextets || hextets.length !== 8) {
    return true;
  }

  const [first = 0] = hextets;
  const firstSixAreZero = hextets.slice(0, 6).every((part) => part === 0);
  return (
    hextets.every((part) => part === 0) ||
    (hextets.slice(0, 7).every((part) => part === 0) && hextets[7] === 1) ||
    (first & 0xffc0) === 0xfe80 ||
    (first & 0xfe00) === 0xfc00 ||
    (first & 0xff00) === 0xff00 ||
    first === 0x2002 ||
    (first === 0x2001 && (hextets[1] ?? 0) <= 0x01ff) ||
    (first === 0x2001 && hextets[1] === 0x0db8) ||
    (first === 0x64 && hextets[1] === 0xff9b) ||
    (firstSixAreZero && isBlockedIpv4(ipv4FromHextets(hextets))) ||
    (hextets.slice(0, 5).every((part) => part === 0) &&
      hextets[5] === 0xffff &&
      isBlockedIpv4(ipv4FromHextets(hextets)))
  );
}

function normalizeIpHost(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

export function isOutboundIpAddress(address: string): boolean {
  return isIP(normalizeIpHost(address.toLowerCase())) !== 0;
}

export function isBlockedOutboundAddress(address: string): boolean {
  const ipHost = normalizeIpHost(address.toLowerCase());
  const ipVersion = isIP(ipHost);
  return (
    ipVersion === 0 ||
    (ipVersion === 4 && isBlockedIpv4(ipHost)) ||
    (ipVersion === 6 && isBlockedIpv6(ipHost))
  );
}

export function isBlockedPrivateNetworkMetadataAddress(
  address: string,
): boolean {
  const ipHost = normalizeIpHost(address.toLowerCase());
  const ipVersion = isIP(ipHost);
  if (ipVersion === 4) {
    return (
      ipHost === "100.100.100.200" ||
      ipHost === "169.254.169.254" ||
      ipHost === "169.254.170.2"
    );
  }
  if (ipVersion !== 6) {
    return true;
  }
  const hextets = parseIpv6Hextets(ipHost);
  if (!hextets || hextets.length !== 8) {
    return true;
  }
  if (
    hextets.slice(0, 5).every((part) => part === 0) &&
    hextets[5] === 0xffff
  ) {
    return isBlockedPrivateNetworkMetadataAddress(ipv4FromHextets(hextets));
  }
  return (
    hextets[0] === 0xfd00 &&
    hextets[1] === 0x0ec2 &&
    hextets.slice(2, 7).every((part) => part === 0) &&
    hextets[7] === 0x0254
  );
}

async function defaultResolveHostname(hostname: string): Promise<string[]> {
  const records = await lookup(hostname, {
    all: true,
    verbatim: true,
  });
  return records.map((record) => record.address);
}

function errorPrefix(label: string | undefined): string {
  return label?.trim() || "Outbound URL";
}

async function validateOutboundHttpUrl(
  rawUrl: string,
  options: OutboundHttpUrlValidationOptions,
): Promise<SafeOutboundHttpUrlValidation> {
  const prefix = errorPrefix(options.label);
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`${prefix} is invalid.`);
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`${prefix} must use http or https.`);
  }
  if (url.username || url.password) {
    throw new Error(`${prefix} must not include credentials.`);
  }

  // Lowercase before both hostname blocklist and IP checks so metadata host
  // aliases cannot bypass exact-name checks with mixed-case input.
  const hostname = url.hostname.toLowerCase();
  if (!hostname) {
    throw new Error(`${prefix} host is not allowed.`);
  }
  if (
    options.rejectLocalhostName &&
    (hostname === "localhost" || hostname.endsWith(".localhost"))
  ) {
    throw new Error(`${prefix} host is not allowed.`);
  }
  if (options.isBlockedHostname?.(hostname)) {
    throw new Error(`${prefix} ${options.blockedHostnameError}`);
  }

  const ipHost = normalizeIpHost(hostname);
  const ipVersion = isIP(ipHost);
  if (ipVersion !== 0) {
    if (options.isBlockedAddress(ipHost)) {
      throw new Error(`${prefix} ${options.blockedAddressError}`);
    }
    return { resolvedAddress: ipHost, url };
  }

  const resolveHostname = options.resolveHostname ?? defaultResolveHostname;
  let addresses: string[];
  try {
    addresses = await resolveHostname(hostname);
  } catch {
    // DNS failures are intentionally collapsed into the same caller-facing
    // resolution error. The outbound fetch guard is a policy boundary, not a
    // resolver diagnostic API: exposing NXDOMAIN/SERVFAIL/timeout details would
    // invite plugins or remote inputs to fingerprint internal resolver behavior
    // without changing the safe next step, which is to reject the request.
    throw new Error(`${prefix} host could not be resolved.`);
  }
  if (addresses.length === 0) {
    throw new Error(`${prefix} host could not be resolved.`);
  }
  if (addresses.some((address) => !isOutboundIpAddress(address))) {
    throw new Error(`${prefix} host resolved to a non-IP address.`);
  }
  if (addresses.some((address) => options.isBlockedAddress(address))) {
    throw new Error(
      `${prefix} host resolved to ${options.blockedResolvedAddressError}`,
    );
  }

  const [resolvedAddress] = addresses;
  if (!resolvedAddress) {
    throw new Error(`${prefix} host could not be resolved.`);
  }
  // Store only this validation result for the immediate outbound request. The
  // fetch wrapper below pins DNS to resolvedAddress for that request, closing
  // same-request DNS-rebinding gaps; recurring refresh jobs intentionally
  // revalidate on each run so stale DNS decisions are not kept indefinitely.
  return { resolvedAddress, url };
}

async function validateSafeOutboundHttpUrl(
  rawUrl: string,
  options: SafeOutboundHttpUrlOptions = {},
): Promise<SafeOutboundHttpUrlValidation> {
  return validateOutboundHttpUrl(rawUrl, {
    ...options,
    blockedAddressError: "host is not allowed.",
    blockedHostnameError: "host is not allowed.",
    blockedResolvedAddressError: "a blocked address.",
    isBlockedAddress: isBlockedOutboundAddress,
    rejectLocalhostName: true,
  });
}

async function validatePrivateNetworkOutboundHttpUrl(
  rawUrl: string,
  options: SafeOutboundHttpUrlOptions = {},
): Promise<SafeOutboundHttpUrlValidation> {
  // This validator is only selected by plugin fetch/WebSocket callers after
  // the plugin has the explicit unsafe private-network grant. That grant allows
  // operator-intended localhost, RFC1918, and unique-local/internal addresses,
  // but still blocks cloud metadata hostnames and addresses because metadata
  // services expose host credentials rather than ordinary LAN resources.
  return validateOutboundHttpUrl(rawUrl, {
    ...options,
    blockedAddressError:
      "unsafe private-network mode cannot access cloud metadata hosts.",
    blockedHostnameError:
      "unsafe private-network mode cannot access cloud metadata hosts.",
    blockedResolvedAddressError: "a cloud metadata address.",
    isBlockedAddress: isBlockedPrivateNetworkMetadataAddress,
    isBlockedHostname: (hostname) =>
      BLOCKED_PRIVATE_NETWORK_METADATA_HOSTS.has(hostname),
    rejectLocalhostName: false,
  });
}

export async function assertSafeOutboundHttpUrl(
  rawUrl: string,
  options: SafeOutboundHttpUrlOptions = {},
): Promise<URL> {
  return (await validateSafeOutboundHttpUrl(rawUrl, options)).url;
}

export async function assertPrivateNetworkOutboundHttpUrl(
  rawUrl: string,
  options: SafeOutboundHttpUrlOptions = {},
): Promise<URL> {
  return (await validatePrivateNetworkOutboundHttpUrl(rawUrl, options)).url;
}

function parseRedirectUrl(
  currentUrl: URL,
  locationHeader: string | null,
  options: SafeOutboundHttpUrlOptions = {},
): URL {
  const prefix = errorPrefix(options.label);
  if (!locationHeader?.trim()) {
    throw new Error(`${prefix} redirect location is missing.`);
  }
  try {
    return new URL(locationHeader, currentUrl);
  } catch {
    throw new Error(`${prefix} redirect location is invalid.`);
  }
}

export async function resolveSafeRedirectUrl(
  currentUrl: URL,
  locationHeader: string | null,
  options: SafeOutboundHttpUrlOptions = {},
): Promise<URL> {
  // Redirect handling is deliberately split: this helper parses and validates
  // the Location target, while createSafeOutboundHttpFetch pins DNS again when
  // the caller issues the next request. node:http never auto-follows here, so
  // every redirect hop gets a fresh blocklist check plus request-local lookup.
  return assertSafeOutboundHttpUrl(
    parseRedirectUrl(currentUrl, locationHeader, options).toString(),
    options,
  );
}

export async function resolvePrivateNetworkRedirectUrl(
  currentUrl: URL,
  locationHeader: string | null,
  options: SafeOutboundHttpUrlOptions = {},
): Promise<URL> {
  return assertPrivateNetworkOutboundHttpUrl(
    parseRedirectUrl(currentUrl, locationHeader, options).toString(),
    options,
  );
}

export function isHttpRedirectStatus(status: number): boolean {
  return (
    status === 301 ||
    status === 302 ||
    status === 303 ||
    status === 307 ||
    status === 308
  );
}

export function pinResolvedOutboundLookupAddress(resolvedAddress: string) {
  return (
    _hostname: string,
    lookupOptions: NodeLookupOptions,
    callback: NodeLookupCallback,
  ): void => {
    const family = isIP(resolvedAddress) || 4;
    if (lookupOptions?.all) {
      // node:http/node:https can request either the single-address callback
      // shape or the all-addresses array shape. Always return the already
      // validated address in the requested shape so the outbound request stays
      // pinned to the SSRF-checked DNS result.
      (
        callback as (
          error: Error | null,
          addresses: Array<{ address: string; family: number }>,
        ) => void
      )(null, [{ address: resolvedAddress, family }]);
      return;
    }
    (
      callback as (error: Error | null, address: string, family: number) => void
    )(null, resolvedAddress, family);
  };
}

function createValidatedOutboundHttpFetch(
  validateUrl: (
    rawUrl: string,
    options: SafeOutboundHttpUrlOptions,
  ) => Promise<SafeOutboundHttpUrlValidation>,
  options: SafeOutboundHttpUrlOptions = {},
): SafeOutboundFetch {
  return async (url, init = {}) => {
    const validation = await validateUrl(url.toString(), options);
    if (init.signal?.aborted) {
      throw (
        init.signal.reason ??
        new Error(`${errorPrefix(options.label)} request was aborted.`)
      );
    }
    const requester = url.protocol === "https:" ? requestHttps : requestHttp;
    const response = await new Promise<Response>((resolve, reject) => {
      const headers = new Headers(init.headers);
      headers.set("host", url.host);
      const request = requester(
        url,
        {
          headers: Object.fromEntries(headers.entries()),
          method: init.method,
          lookup: pinResolvedOutboundLookupAddress(validation.resolvedAddress),
          signal: init.signal ?? undefined,
        },
        (nodeResponse) => {
          const responseHeaders = new Headers();
          for (const [key, value] of Object.entries(nodeResponse.headers)) {
            if (Array.isArray(value)) {
              for (const item of value) {
                responseHeaders.append(key, item);
              }
            } else if (typeof value === "string") {
              responseHeaders.set(key, value);
            }
          }
          resolve(
            new Response(nodeResponse as unknown as BodyInit, {
              headers: responseHeaders,
              status: nodeResponse.statusCode ?? 0,
              statusText: nodeResponse.statusMessage ?? "",
            }),
          );
        },
      );
      request.on("error", reject);
      if (init.body !== undefined && init.body !== null) {
        if (typeof init.body === "string" || init.body instanceof Buffer) {
          request.write(init.body);
        } else if (init.body instanceof ArrayBuffer) {
          request.write(Buffer.from(init.body));
        } else if (ArrayBuffer.isView(init.body)) {
          request.write(
            Buffer.from(
              init.body.buffer,
              init.body.byteOffset,
              init.body.byteLength,
            ),
          );
        } else {
          reject(
            new Error(
              `${errorPrefix(options.label)} request body type is not supported.`,
            ),
          );
          request.destroy();
          return;
        }
      }
      request.end();
    });

    if (init.redirect === "manual" || !isHttpRedirectStatus(response.status)) {
      return response;
    }
    // node:http and node:https do not auto-follow redirects. Returning manual
    // redirect responses is safe because callers must explicitly resolve and
    // revalidate Location with resolveSafeRedirectUrl before issuing another
    // outbound request; the default path rejects redirects outright.
    throw new Error(`${errorPrefix(options.label)} unexpected redirect.`);
  };
}

export function createSafeOutboundHttpFetch(
  options: SafeOutboundHttpUrlOptions = {},
): SafeOutboundFetch {
  return createValidatedOutboundHttpFetch(validateSafeOutboundHttpUrl, options);
}

export function createPrivateNetworkOutboundHttpFetch(
  options: SafeOutboundHttpUrlOptions = {},
): SafeOutboundFetch {
  return createValidatedOutboundHttpFetch(
    validatePrivateNetworkOutboundHttpUrl,
    options,
  );
}
