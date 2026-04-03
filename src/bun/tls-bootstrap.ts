import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import { getDefaultTlsPaths } from "./tls-config";

export type TlsBootstrapStrategy = "mkcert" | "openssl";

export type TlsBootstrapOptions = {
  forceOverwrite: boolean;
  trustSystemCertificate: boolean;
};

function decodeCommandOutput(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString("utf8");
  }
  return "";
}

function ensureTlsDirectory(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, {
      recursive: true,
      mode: 0o700,
    });
  }
  try {
    chmodSync(path, 0o700);
  } catch {
    // Windows does not reliably support POSIX chmod semantics.
  }
}

function applyOwnerOnlyFilePermissions(path: string): void {
  try {
    chmodSync(path, 0o600);
  } catch {
    // Windows does not reliably support POSIX chmod semantics.
  }
}

function runCommand(command: string[], failureMessage: string): string {
  const result = Bun.spawnSync({
    cmd: command,
    stderr: "pipe",
    stdout: "pipe",
  });
  if (result.exitCode === 0) {
    return decodeCommandOutput(result.stdout).trim();
  }

  const stderr = decodeCommandOutput(result.stderr).trim();
  throw new Error(
    stderr
      ? `${failureMessage} ${stderr}`
      : `${failureMessage} ${command.join(" ")}`,
  );
}

export function parseTlsBootstrapArgs(args: string[]): TlsBootstrapOptions {
  let forceOverwrite = false;
  let trustSystemCertificate = false;

  for (const arg of args) {
    if (arg === "--force") {
      forceOverwrite = true;
      continue;
    }
    if (arg === "--trust") {
      trustSystemCertificate = true;
      continue;
    }
    throw new Error(
      `Unknown tls bootstrap flag "${arg}". Expected --force or --trust.`,
    );
  }

  return {
    forceOverwrite,
    trustSystemCertificate,
  };
}

export function detectTlsBootstrapStrategy(
  whichCommand: (command: string) => string | null = Bun.which,
): TlsBootstrapStrategy | null {
  if (whichCommand("mkcert")) {
    return "mkcert";
  }
  if (whichCommand("openssl")) {
    return "openssl";
  }
  return null;
}

export function buildOpenSslConfig(): string {
  return [
    "[req]",
    "distinguished_name = req_distinguished_name",
    "x509_extensions = v3_req",
    "prompt = no",
    "",
    "[req_distinguished_name]",
    "CN = localhost",
    "",
    "[v3_req]",
    "subjectAltName = @alt_names",
    "basicConstraints = critical,CA:FALSE",
    "keyUsage = critical,digitalSignature,keyEncipherment",
    "extendedKeyUsage = serverAuth",
    "",
    "[alt_names]",
    "DNS.1 = localhost",
    "IP.1 = 127.0.0.1",
    "IP.2 = ::1",
  ].join("\n");
}

function removeExistingTlsFiles(
  paths: ReturnType<typeof getDefaultTlsPaths>,
  options: TlsBootstrapOptions,
): void {
  const existingPaths = [paths.certPath, paths.keyPath, paths.caPath].filter(
    (path) => existsSync(path),
  );
  if (existingPaths.length === 0) {
    return;
  }
  if (!options.forceOverwrite) {
    throw new Error(
      `TLS files already exist at ${existingPaths.join(", ")}. Re-run with --force to overwrite them.`,
    );
  }
  for (const path of existingPaths) {
    rmSync(path, {
      force: true,
    });
  }
}

function createMkcertArtifacts(
  paths: ReturnType<typeof getDefaultTlsPaths>,
  options: TlsBootstrapOptions,
): void {
  if (options.trustSystemCertificate) {
    runCommand(["mkcert", "-install"], "Failed to install the mkcert root CA.");
  }

  runCommand(
    [
      "mkcert",
      "-cert-file",
      paths.certPath,
      "-key-file",
      paths.keyPath,
      "localhost",
      "127.0.0.1",
      "::1",
    ],
    "Failed to generate loopback TLS certificates with mkcert.",
  );

  const caRootDirectory = runCommand(
    ["mkcert", "-CAROOT"],
    "Failed to locate the mkcert CA root directory.",
  );
  const rootCaPath = join(caRootDirectory, "rootCA.pem");
  if (!existsSync(rootCaPath)) {
    throw new Error(`mkcert did not expose a root CA at ${rootCaPath}.`);
  }
  cpSync(rootCaPath, paths.caPath);
}

function createOpenSslArtifacts(
  paths: ReturnType<typeof getDefaultTlsPaths>,
  options: TlsBootstrapOptions,
): void {
  if (options.trustSystemCertificate) {
    throw new Error(
      "--trust requires mkcert. The OpenSSL fallback can generate a certificate, but it cannot install OS trust automatically.",
    );
  }

  const configPath = join(dirname(paths.certPath), "openssl-loopback.cnf");
  writeFileSync(configPath, buildOpenSslConfig(), {
    encoding: "utf8",
    mode: 0o600,
  });

  try {
    runCommand(
      [
        "openssl",
        "req",
        "-x509",
        "-nodes",
        "-newkey",
        "rsa:2048",
        "-sha256",
        "-days",
        "825",
        "-keyout",
        paths.keyPath,
        "-out",
        paths.certPath,
        "-config",
        configPath,
        "-extensions",
        "v3_req",
      ],
      "Failed to generate a loopback TLS certificate with OpenSSL.",
    );
  } finally {
    rmSync(configPath, {
      force: true,
    });
  }

  cpSync(paths.certPath, paths.caPath);
}

function buildManualTrustInstructions(platform: NodeJS.Platform): string {
  if (platform === "darwin") {
    return [
      "Import the generated CA/certificate into Keychain Access.",
      "Place it in the login keychain and mark it as Always Trust for SSL.",
    ].join(" ");
  }
  if (platform === "win32") {
    return [
      "Import the generated CA/certificate into the Current User Trusted Root Certification Authorities store.",
      "The built-in certmgr.msc workflow is the simplest path.",
    ].join(" ");
  }
  return [
    "Import the generated CA/certificate into your OS or browser trust store.",
    "On Linux, prefer mkcert when available because browser trust configuration varies by distro.",
  ].join(" ");
}

function printBootstrapSummary(
  strategy: TlsBootstrapStrategy,
  options: TlsBootstrapOptions,
  paths: ReturnType<typeof getDefaultTlsPaths>,
): void {
  const trustSummary =
    strategy === "mkcert"
      ? options.trustSystemCertificate
        ? "The mkcert root CA was installed into the local trust stores."
        : "If the browser still warns about the certificate, re-run with --trust or run mkcert -install."
      : buildManualTrustInstructions(process.platform);

  console.log(
    [
      `[jolt] TLS bootstrap complete using ${strategy}.`,
      `cert: ${paths.certPath}`,
      `key: ${paths.keyPath}`,
      `ca: ${paths.caPath}`,
      trustSummary,
      "Start Jolt with `bun run start` or `bun run start:monolith` once the certificate is trusted.",
    ].join("\n"),
  );
}

async function main(): Promise<void> {
  const options = parseTlsBootstrapArgs(Bun.argv.slice(2));
  const strategy = detectTlsBootstrapStrategy();
  if (!strategy) {
    throw new Error(
      "Unable to find mkcert or openssl on PATH. Install mkcert for the preferred guided flow, or install openssl for the fallback certificate generator.",
    );
  }

  const paths = getDefaultTlsPaths();
  ensureTlsDirectory(dirname(paths.certPath));
  removeExistingTlsFiles(paths, options);

  if (strategy === "mkcert") {
    createMkcertArtifacts(paths, options);
  } else {
    createOpenSslArtifacts(paths, options);
  }

  for (const path of [paths.certPath, paths.keyPath, paths.caPath]) {
    applyOwnerOnlyFilePermissions(path);
  }

  printBootstrapSummary(strategy, options, paths);
}

if (import.meta.main) {
  await main();
}
