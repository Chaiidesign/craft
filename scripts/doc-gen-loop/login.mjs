#!/usr/bin/env node
// One-time login for the doc-generation baseline harness.
//
// Opens a visible browser at the local app, waits for a person to log in, then
// saves the browser session to .auth/souvenir.json (gitignored, mode 600). The
// run script reuses that session headless. The file holds a session cookie:
// never print it, read it back or commit it.
//
//   node scripts/doc-gen-loop/login.mjs [--base http://localhost:3000] [--dia]
//
// --dia opens the Dia browser (Chromium-based) instead of Playwright's Chromium,
// with its own throwaway profile, so the person's normal Dia profile is untouched.
// The saved session works the same either way; the runs stay headless Chromium.

import { chmodSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

const ROOT = resolve(import.meta.dirname, "../..");
const STATE = resolve(ROOT, ".auth/souvenir.json");
const base = process.argv.includes("--base") ? process.argv[process.argv.indexOf("--base") + 1] : "http://localhost:3000";
const LOGIN_TIMEOUT_MS = 20 * 60_000;

mkdirSync(resolve(ROOT, ".auth"), { recursive: true, mode: 0o700 });

const DIA = "/Applications/Dia.app/Contents/MacOS/Dia";
const useDia = process.argv.includes("--dia");
let profile = null;
let browser = null;
let context;
if (useDia) {
  profile = mkdtempSync(resolve(tmpdir(), "doc-gen-loop-dia-"));
  context = await chromium.launchPersistentContext(profile, { executablePath: DIA, headless: false, viewport: null });
} else {
  browser = await chromium.launch({ headless: false });
  context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
}
const origin = new URL(base).origin;
const cleanup = () => { if (profile) rmSync(profile, { recursive: true, force: true }); };
let closed = false;
context.on("close", () => { closed = true; });
const first = context.pages()[0] ?? (await context.newPage());
await first.goto(base);
console.log(`[login] browser open at ${base}. Log in; this waits up to 20 minutes.`);

// Logged in = some tab is back on the app origin, off /auth and /onboarding, with
// the chat composer showing. Every tab is checked, so a tab that closes or is
// replaced during the Auth0 redirect doesn't end the wait; only closing the
// whole browser does.
const loggedIn = async () => {
  for (const p of context.pages()) {
    const ok = await p.evaluate((o) =>
      location.origin === o &&
      !location.pathname.startsWith("/auth") &&
      !location.pathname.startsWith("/onboarding") &&
      document.querySelector("textarea") !== null, origin).catch(() => false);
    if (ok) return true;
  }
  return false;
};
const deadline = Date.now() + LOGIN_TIMEOUT_MS;
while (!(await loggedIn())) {
  if (closed || Date.now() > deadline) {
    console.log(closed ? "[login] the browser was closed before login finished; nothing saved." : "[login] timed out; nothing saved.");
    cleanup();
    process.exit(1);
  }
  if (context.pages().length === 0) await context.newPage().then((p) => p.goto(base)).catch(() => {});
  await new Promise((r) => setTimeout(r, 1000));
}

await context.storageState({ path: STATE });
chmodSync(STATE, 0o600);
console.log("[login] session saved to .auth/souvenir.json (mode 600). Closing the browser.");
await (browser ?? context).close();
cleanup();
