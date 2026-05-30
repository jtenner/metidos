/**
 * @file src/bun/http-forwarded.ts
 * @description Helpers for explicit reverse-proxy forwarded-header trust.
 */

import { isIP } from "node:net";

export type ForwardedProto = "http" | "https";

export type ForwardedHeaderTrustOptions = {
  /**
   * Immediate TCP peer address as reported by the Bun server. Forwarded
   * headers are ignored unless this peer is trusted as a reverse proxy.
   */
  peerAddress?: string | null;
};

function readFirstHeaderValue(value: string | null): string | null {
  const firstValue = value?.split(",")[0]?.trim();
  return firstValue ? firstValue : null;
}

export function isForwardedHeaderTrustEnabled(): boolean {
  const value = process.env.METIDOS_TRUST_PROXY?.trim().toLowerCase();
  return value === "true" || value === "1";
}

function readAllowedForwardedOrigins(): Set<string> {
  const values = [
    process.env.METIDOS_PUBLIC_ORIGIN,
    process.env.METIDOS_ALLOWED_FORWARDED_ORIGINS,
  ];
  const origins = new Set<string>();
  for (const value of values) {
    for (const token of value?.split(/[\s,]+/) ?? []) {
      const normalized = normalizeForwardedOrigin(token);
      if (normalized) {
        origins.add(normalized);
      }
    }
  }
  return origins;
}

function normalizeForwardedOrigin(origin: string): string | null {
  try {
    const url = new URL(origin.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    if (
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function parseIpv4Address(value: string): number | null {
  const parts = value.split(".");
  if (parts.length !== 4) {
    return null;
  }

  let result = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/u.test(part)) {
      return null;
    }
    const octet = Number.parseInt(part, 10);
    if (octet < 0 || octet > 255) {
      return null;
    }
    result = (result << 8) | octet;
  }
  return result >>> 0;
}

function normalizePeerAddress(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  const ipv4Mapped = /^::ffff:(?<address>\d{1,3}(?:\.\d{1,3}){3})$/iu.exec(
    trimmed,
  )?.groups?.address;
  const candidate = ipv4Mapped ?? trimmed;
  return isIP(candidate) !== 0 ? candidate.toLowerCase() : null;
}

function isLoopbackPeerAddress(address: string): boolean {
  if (address === "::1") {
    return true;
  }
  const ipv4 = parseIpv4Address(address);
  return ipv4 !== null && ipv4 >>> 24 === 127;
}

function ipv4PeerMatchesCidr(address: string, cidr: string): boolean {
  const [baseAddress, prefixText] = cidr.split("/");
  if (typeof baseAddress !== "string" || typeof prefixText !== "string") {
    return false;
  }
  const peer = parseIpv4Address(address);
  const base = parseIpv4Address(baseAddress.trim());
  const prefixLength = Number.parseInt(prefixText.trim(), 10);
  if (
    peer === null ||
    base === null ||
    !Number.isInteger(prefixLength) ||
    prefixLength < 0 ||
    prefixLength > 32
  ) {
    return false;
  }
  if (prefixLength === 0) {
    return true;
  }
  const mask = (0xffffffff << (32 - prefixLength)) >>> 0;
  return (peer & mask) === (base & mask);
}

function readTrustedProxyPeerTokens(): string[] {
  const raw = process.env.METIDOS_TRUSTED_PROXY_PEERS?.trim();
  if (!raw) {
    return ["loopback"];
  }
  // Operators should prefer explicit proxy IPs/CIDRs. The "*" token is kept
  // only for tightly controlled deployments where every immediate TCP peer is
  // known to sanitize X-Forwarded-* headers before they reach Metidos; otherwise
  // client-supplied first-hop values could shard rate-limit buckets.
  return raw.split(/[\s,]+/u).filter(Boolean);
}

export function isForwardedHeaderPeerTrusted(
  options: ForwardedHeaderTrustOptions = {},
): boolean {
  if (!isForwardedHeaderTrustEnabled()) {
    return false;
  }

  const peerAddress = normalizePeerAddress(options.peerAddress);
  if (!peerAddress) {
    return false;
  }

  for (const token of readTrustedProxyPeerTokens()) {
    const normalizedToken = token.trim().toLowerCase();
    if (!normalizedToken) {
      continue;
    }
    if (normalizedToken === "*") {
      return true;
    }
    if (normalizedToken === "loopback" && isLoopbackPeerAddress(peerAddress)) {
      return true;
    }
    if (normalizedToken.includes("/")) {
      if (ipv4PeerMatchesCidr(peerAddress, normalizedToken)) {
        return true;
      }
      continue;
    }
    if (normalizePeerAddress(normalizedToken) === peerAddress) {
      return true;
    }
  }

  return false;
}

export function readTrustedForwardedProto(
  request: Request,
  options?: ForwardedHeaderTrustOptions,
): ForwardedProto | null {
  if (!isForwardedHeaderPeerTrusted(options)) {
    return null;
  }

  const forwardedProto = readFirstHeaderValue(
    request.headers.get("x-forwarded-proto"),
  )?.toLowerCase();
  if (forwardedProto === "http" || forwardedProto === "https") {
    return forwardedProto;
  }
  return null;
}

function normalizeForwardedPeerAddress(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes(",")) {
    return null;
  }

  // RFC 7239-style values sometimes include a port or IPv6 brackets after a
  // trusted proxy has adapted them into X-Forwarded-For. Hostnames are
  // intentionally rejected instead of DNS-resolved: rate-limit and audit keys
  // must be bounded, literal peer addresses, not attacker-controlled names.
  const bracketedIpv6 = /^\[(?<address>[^\]]+)\](?::\d+)?$/u.exec(trimmed)
    ?.groups?.address;
  if (bracketedIpv6) {
    return isIP(bracketedIpv6) !== 0 ? bracketedIpv6.toLowerCase() : null;
  }

  if (isIP(trimmed) !== 0) {
    return trimmed.toLowerCase();
  }

  const ipv4WithPort = /^(?<address>\d{1,3}(?:\.\d{1,3}){3}):\d+$/u.exec(
    trimmed,
  )?.groups?.address;
  if (ipv4WithPort && isIP(ipv4WithPort) === 4) {
    return ipv4WithPort;
  }

  return null;
}

export function readTrustedForwardedForPeer(
  request: Request,
  options?: ForwardedHeaderTrustOptions,
): string | null {
  if (!isForwardedHeaderPeerTrusted(options)) {
    return null;
  }

  const firstForwardedFor = readFirstHeaderValue(
    request.headers.get("x-forwarded-for"),
  );
  if (!firstForwardedFor) {
    return null;
  }

  const normalized = normalizeForwardedPeerAddress(firstForwardedFor);
  return normalized ? `forwarded:${normalized}` : null;
}

export function resolveTrustedForwardedOrigin(
  request: Request,
  options?: ForwardedHeaderTrustOptions,
): string | null {
  if (!isForwardedHeaderPeerTrusted(options)) {
    return null;
  }

  const forwardedHost = readFirstHeaderValue(
    request.headers.get("x-forwarded-host"),
  );
  const forwardedProto = readTrustedForwardedProto(request, options);
  if (!forwardedHost || !forwardedProto) {
    return null;
  }

  const forwardedOrigin = normalizeForwardedOrigin(
    `${forwardedProto}://${forwardedHost}`,
  );
  if (!forwardedOrigin) {
    return null;
  }

  const allowedOrigins = readAllowedForwardedOrigins();
  if (allowedOrigins.size === 0 || !allowedOrigins.has(forwardedOrigin)) {
    return null;
  }

  return forwardedOrigin;
}

export function isSecureRequest(
  request: Request,
  options?: ForwardedHeaderTrustOptions & { publicTls?: boolean },
): boolean {
  const forwardedProto = readTrustedForwardedProto(request, options);
  if (forwardedProto === "https") {
    return true;
  }
  if (forwardedProto === "http") {
    return false;
  }
  if (options?.publicTls) {
    // This helper is used to decide response cookie attributes in a deployment
    // whose public entrypoint is TLS-terminated. Auth origin/CSRF checks do not
    // rely on this branch to trust a request as secure.
    return true;
  }
  return new URL(request.url).protocol === "https:";
}
