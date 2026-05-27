#!/usr/bin/env bun

import { existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import process from "node:process";

const DEFAULT_PORT = (process.env.METIDOS_PORT || "7599").trim() || "7599";
const DEFAULT_ORIGIN =
  process.env.METIDOS_PUBLIC_ORIGIN?.trim() ||
  `http://127.0.0.1:${DEFAULT_PORT}`;

function printHelp() {
  console.log(`Metidos one-time TOTP helper

Usage:
  bun run .pi/skills/metidos-installation/setup-otp.js --username <name> [--origin <origin>] [--issuer <issuer>] [--full]

Examples:
  bun run .pi/skills/metidos-installation/setup-otp.js --username alice
  bun run .pi/skills/metidos-installation/setup-otp.js --username alice --origin https://metidos.example.com
  bun run .pi/skills/metidos-installation/setup-otp.js --username alice --origin http://127.0.0.1:7599 --issuer Metidos

Notes:
  - Run this from the project root after 'bun install'.
  - Start and host Metidos first, then run this helper.
  - This helper calls /auth/setup/start on the running Metidos server and renders the returned otpauth URI as a terminal QR code.
  - Use the same username in the browser setup flow.
`);
}

function parseArgs(argv) {
  const args = {
    full: false,
    issuer: "",
    origin: DEFAULT_ORIGIN,
    username: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) {
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }

    if (arg === "--full") {
      args.full = true;
      continue;
    }

    if (arg.startsWith("--username=")) {
      args.username = arg.slice("--username=".length).trim();
      continue;
    }

    if (arg === "--username") {
      args.username = (argv[index + 1] || "").trim();
      index += 1;
      continue;
    }

    if (arg.startsWith("--origin=")) {
      args.origin = arg.slice("--origin=".length).trim();
      continue;
    }

    if (arg === "--origin") {
      args.origin = (argv[index + 1] || "").trim();
      index += 1;
      continue;
    }

    if (arg.startsWith("--issuer=")) {
      args.issuer = arg.slice("--issuer=".length).trim();
      continue;
    }

    if (arg === "--issuer") {
      args.issuer = (argv[index + 1] || "").trim();
      index += 1;
      continue;
    }

    console.error(`Unknown argument: ${arg}`);
    console.error("Use --help for usage.");
    process.exit(1);
  }

  return args;
}

async function promptForMissingInput(args) {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    if (!args.username) {
      args.username = (
        await rl.question("Username to enroll for TOTP: ")
      ).trim();
    }

    const originAnswer = (
      await rl.question(`Metidos origin [${args.origin}]: `)
    ).trim();
    if (originAnswer) {
      args.origin = originAnswer;
    }

    const issuerAnswer = (
      await rl.question(
        `Issuer label [${args.issuer || "Metidos"}] (press Enter to keep default): `,
      )
    ).trim();
    if (issuerAnswer) {
      args.issuer = issuerAnswer;
    }
  } finally {
    rl.close();
  }
}

function assertProjectRoot() {
  if (!existsSync("package.json") || !existsSync("src/bun/index.ts")) {
    console.error(
      "Run this helper from the Metidos project root so Bun can load the repo env and dependencies.",
    );
    process.exit(1);
  }
}

async function loadQrModule() {
  try {
    const module = await import("qrcode");
    const candidate = module.default ?? module;
    if (typeof candidate.toString !== "function") {
      throw new Error("qrcode did not expose toString().");
    }
    return candidate;
  } catch (error) {
    console.error("Could not load qrcode.");
    console.error("Run 'bun install' from the project root first.");
    if (error instanceof Error && error.message) {
      console.error(error.message);
    }
    process.exit(1);
  }
}

async function readErrorMessage(response) {
  const text = await response.text();
  if (!text) {
    return `HTTP ${response.status}`;
  }

  try {
    const payload = JSON.parse(text);
    if (payload && typeof payload === "object") {
      if (
        "error" in payload &&
        payload.error &&
        typeof payload.error === "object" &&
        "message" in payload.error &&
        typeof payload.error.message === "string"
      ) {
        return payload.error.message;
      }
      if ("message" in payload && typeof payload.message === "string") {
        return payload.message;
      }
    }
  } catch {
    // fall through to raw text
  }

  return text;
}

async function requestEnrollment({ origin, username, issuer }) {
  const targetUrl = new URL("/auth/setup/start", origin);
  const response = await fetch(targetUrl, {
    body: JSON.stringify(
      issuer
        ? {
            issuer,
            username,
          }
        : {
            username,
          },
    ),
    headers: {
      "content-type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    const errorMessage = await readErrorMessage(response);
    throw new Error(
      `Metidos returned ${response.status} ${response.statusText}: ${errorMessage}`,
    );
  }

  const payload = await response.json();
  const enrollment = payload?.enrollment;
  if (
    !enrollment ||
    typeof enrollment !== "object" ||
    typeof enrollment.totpSecret !== "string" ||
    typeof enrollment.totpUri !== "string"
  ) {
    throw new Error("Metidos returned an invalid enrollment payload.");
  }

  return enrollment;
}

async function main() {
  assertProjectRoot();
  const args = parseArgs(process.argv.slice(2));
  await promptForMissingInput(args);

  if (!args.username) {
    console.error("A username is required.");
    process.exit(1);
  }

  if (!/^https?:\/\//.test(args.origin)) {
    console.error("Origin must include http:// or https://");
    process.exit(1);
  }

  const qrcode = await loadQrModule();

  console.log("Requesting TOTP enrollment from the running Metidos server...");
  console.log(`Origin: ${args.origin}`);
  console.log(`Username: ${args.username}`);

  let enrollment;
  try {
    enrollment = await requestEnrollment(args);
  } catch (error) {
    console.error("Failed to prepare TOTP enrollment.");
    if (error instanceof Error && error.message) {
      console.error(error.message);
    }
    console.error(
      "Make sure Metidos is already running and reachable at the chosen origin before using this helper.",
    );
    process.exit(1);
  }

  console.log("\nScan this QR code with your authenticator app:\n");
  const terminalQrCode = await qrcode.toString(enrollment.totpUri, {
    small: !args.full,
    type: "terminal",
  });
  console.log(terminalQrCode);

  console.log("\nManual TOTP secret:\n");
  console.log(enrollment.totpSecret);

  console.log("\nNext steps:\n");
  console.log(`1. Open ${args.origin} in your browser.`);
  console.log(`2. Use the same username: ${args.username}`);
  console.log(
    "3. Enter the primary factor configured for this local operator when prompted.",
  );
  console.log(
    "4. Enter the current 6-digit authenticator code from the app you just enrolled.",
  );
  console.log("5. Finish setup in the browser.");
  console.log("6. Save all 10 one-time recovery codes before continuing.");
}

await main();
