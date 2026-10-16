#!/usr/bin/env node
// One-time login for the doc-generation baseline harness.
//
// Opens a visible browser at the local app, waits for a person to log in, then
// saves the browser session to .auth/souvenir.json (gitignored, mode 600). The
// run script reuses that session headless. The file holds a session cookie:
// never print it, read it back or commit it.
//
//   node scripts/doc-gen-loop/login.mjs [--base http://localhost:3000]

import { chmodSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

const ROOT = resolve(import.meta.dirname, "../..");
const STATE = resolve(ROOT, ".auth/souvenir.json");
const base = process.argv.includes("--base") ? process.argv[process.argv.indexOf("--base") + 1] : "http://localhost:3000";
const LOGIN_TIMEOUT_MS = 20 * 60_000;

mkdirSync(resolve(ROOT, ".auth"), { recursive: true, mode: 0o700 });

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
await page.goto(base);
console.log(`[login] browser open at ${base}. Log in; this waits up to 20 minutes.`);

// Logged in = back on the app origin, off /auth and /onboarding, with the chat composer showing.
await page.waitForFunction(
  (origin) =>
    location.origin === origin &&
    !location.pathname.startsWith("/auth") &&
    !location.pathname.startsWith("/onboarding") &&
    document.querySelector("textarea") !== null,
  new URL(base).origin,
  { timeout: LOGIN_TIMEOUT_MS, polling: 1000 },
);

await context.storageState({ path: STATE });
chmodSync(STATE, 0o600);
console.log("[login] session saved to .auth/souvenir.json (mode 600). Closing the browser.");
await browser.close();
