#!/usr/bin/env node
// Doc-generation baseline harness: one pass over scripts/doc-gen-loop/matrix.json
// against the locally running app (which proxies to the shared dev backend).
//
//   node scripts/doc-gen-loop/run.mjs --pass 1 [--only 01a,04b] [--headed] [--base http://localhost:3000]
//
// --headed shows the browser so the interface can be watched. Runs already
// finished in this pass (ok, or failed twice) are skipped, so a stopped pass
// can be restarted without repeating chats; the 2-minute spacing counts from
// the last recorded run.
//
// Reuses the session saved by login.mjs. Changes no app code. Per run it records
// one line in docs/reports/doc-gen-loop/runs.jsonl plus screenshots and any
// generated files under pass-<n>/.
//
// Safety (agreed 2026-10-16):
// - one run starts at most every 2 minutes; at most 40 runs in total, retries included
// - any 401/403, or being sent back to login, stops everything (STOPPED.md says why)
// - a file named STOP in docs/reports/doc-gen-loop/ stops it (checked every 5 s)
// - a failed run is retried once at most, never after an auth error
// - prompts are prefixed "[loop-test] " so the chats can be found and deleted

import { execFileSync } from "node:child_process";
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

const ROOT = resolve(import.meta.dirname, "../..");
const OUT = resolve(ROOT, "docs/reports/doc-gen-loop");
const STATE = resolve(ROOT, ".auth/souvenir.json");
const RUNS = resolve(OUT, "runs.jsonl");
const STOP = resolve(OUT, "STOP");

const arg = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback);
const BASE = arg("--base", "http://localhost:3000");
const PASS = Number(arg("--pass", "1"));
const ONLY = arg("--only", "")?.split(",").filter(Boolean) ?? [];
const APP_DIR = arg("--app-dir", resolve(process.env.HOME, "craft"));
const HEADED = process.argv.includes("--headed");

const SPACING_MS = 2 * 60_000;
const MAX_RUNS = 40;
const RUN_TIMEOUT_MS = 5 * 60_000;
const SAMPLE_MS = 250;

const matrix = JSON.parse(readFileSync(resolve(import.meta.dirname, "matrix.json"), "utf8"));
const passDir = resolve(OUT, `pass-${PASS}`);
mkdirSync(resolve(passDir, "files"), { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
const runsSoFar = () => (existsSync(RUNS) ? readFileSync(RUNS, "utf8").split("\n").filter(Boolean).length : 0);
const words = (s) => (s.match(/[\p{L}\p{N}][\p{L}\p{N}'’.,-]*/gu) ?? []).length;

class Halt extends Error {
  constructor(kind, reason) { super(reason); this.kind = kind; }
}

function stopped(kind, reason) {
  writeFileSync(resolve(OUT, "STOPPED.md"), `# Stopped\n\n- When: ${new Date().toISOString()}\n- Pass: ${PASS}\n- Why: ${kind}: ${reason}\n`);
  log(`STOPPED (${kind}): ${reason}`);
}

// Waits, checking the kill switch every 5 s.
async function waitWithStop(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (existsSync(STOP)) throw new Halt("stop-file", "STOP file found");
    await sleep(Math.min(5000, end - Date.now()));
  }
}

// ── Stream capture, installed in the page (harness-side; app code untouched) ──
// Wraps XMLHttpRequest for the chat stream and keeps a compact event log in window.__loop.
function streamProbe() {
  const STREAM = /\/api\/(chat|persona-chat)\b|\/chats\/(create|[^/]+\/stream|[^/]+\/resume)\b/;
  const L = (window.__loop = { streams: [] });
  const Open = XMLHttpRequest.prototype.open;
  const Send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__loopUrl = String(url);
    return Open.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (body) {
    if (STREAM.test(this.__loopUrl ?? "")) {
      const s = { url: this.__loopUrl.replace(/\?.*$/, ""), tSend: Date.now(), tFirstByte: null, tFirstText: null, tEnd: null,
        status: null, events: [], textChars: 0, textDeltas: 0, heartbeats: 0, parseErrors: 0 };
      L.streams.push(s);
      let seen = 0;
      let buf = "";
      const pump = () => {
        const txt = this.responseText ?? "";
        if (txt.length > seen && s.tFirstByte === null) s.tFirstByte = Date.now();
        buf += txt.slice(seen);
        seen = txt.length;
        const frames = buf.split(/\r?\n\r?\n/);
        buf = frames.pop() ?? "";
        for (const f of frames) {
          const data = f.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart()).join("\n");
          if (!data) continue;
          let e;
          try { e = JSON.parse(data); } catch { s.parseErrors++; continue; }
          const t = Date.now();
          if (e.type === "TEXT_MESSAGE_CONTENT") {
            if (s.tFirstText === null) s.tFirstText = t;
            s.textDeltas++;
            s.textChars += (e.delta ?? "").length;
            continue;
          }
          if (e.type === "CUSTOM" && e.name === "stream_heartbeat") { s.heartbeats++; continue; }
          const v = e.value ?? {};
          const keep = { t, type: e.type };
          if (e.type === "CUSTOM") {
            keep.name = e.name;
            const pick = ["text", "heading", "message", "step", "filename", "mime_type", "url", "model", "model_id", "model_name",
              "provider", "title", "tool_name", "status", "prompt_id", "summary", "display_name"];
            for (const k of pick) if (v[k] !== undefined) keep[k] = typeof v[k] === "string" ? v[k].slice(0, 300) : v[k];
            if (e.name === "model_selected") keep.raw = JSON.stringify(v).slice(0, 400);
          } else if (e.type === "RUN_ERROR") {
            keep.message = String(e.message ?? "").slice(0, 600);
            keep.code = e.code;
          } else if (e.type === "TOOL_CALL_START") {
            keep.tool = e.toolCallName;
            keep.id = e.toolCallId;
          } else if (e.type === "TOOL_CALL_END" || e.type === "TOOL_CALL_RESULT") {
            keep.id = e.toolCallId;
          } else if (e.type === "RUN_STARTED") {
            keep.threadId = e.threadId;
          }
          s.events.push(keep);
        }
      };
      this.addEventListener("progress", pump);
      this.addEventListener("loadend", () => { pump(); s.status = this.status; s.tEnd = Date.now(); });
    }
    return Send.call(this, body);
  };
}

// Text of every "thinking" surface in the latest assistant turn.
function thinkingTexts() {
  const arts = [...document.querySelectorAll('[data-message-id][role="article"]')];
  const last = arts[arts.length - 1];
  const scope = last ?? document;
  const sel = ".kaya-thinking-trigger, .kaya-model-choosing, .kaya-label-shimmer, [aria-expanded]";
  const found = [...scope.querySelectorAll(sel)].map((el) => (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ")).filter(Boolean);
  const global = [...document.querySelectorAll(".kaya-model-choosing")].map((el) => (el.innerText || "").trim()).filter(Boolean);
  return [...new Set([...found, ...global])].map((t) => t.slice(0, 200));
}

// Shape of the latest assistant turn.
function replyShape() {
  const arts = [...document.querySelectorAll('[data-message-id][role="article"]')];
  const last = arts[arts.length - 1];
  if (!last) return null;
  const tables = [...last.querySelectorAll("table")].map((t) => ({ rows: t.querySelectorAll("tr").length, cols: t.querySelector("tr")?.children.length ?? 0 }));
  return {
    messageId: last.getAttribute("data-message-id"),
    text: (last.innerText || "").trim(),
    headings: last.querySelectorAll("h1, h2, h3, h4").length,
    listItems: last.querySelectorAll("li").length,
    tables,
    codeBlocks: last.querySelectorAll("pre").length,
    codeText: [...last.querySelectorAll("pre")].map((p) => p.innerText).join("\n\n").slice(0, 20000),
    fileChips: [...last.querySelectorAll('a[aria-label="View"]')].map((a) => ({ href: a.getAttribute("href") })),
    downloadLinks: [...last.querySelectorAll('a[aria-label="Download"]')].map((a) => ({ href: a.getAttribute("href"), download: a.getAttribute("download") })),
    artifactCards: last.querySelectorAll(".brain-artifact-card").length,
    awaitingInput: !!document.querySelector('[class*="PromptCard"], [data-prompt-id]'),
  };
}

function fileText(path, ext) {
  try {
    if (ext === "pdf") return execFileSync("pdftotext", ["-layout", path, "-"], { encoding: "utf8", timeout: 20000 });
    if (ext === "docx") return execFileSync("unzip", ["-p", path, "word/document.xml"], { encoding: "utf8", timeout: 20000, maxBuffer: 20e6 }).replace(/<\/w:p>/g, "\n").replace(/<[^>]+>/g, "");
    if (["md", "txt", "json", "csv", "html"].includes(ext)) return readFileSync(path, "utf8");
  } catch { /* unreadable: leave null */ }
  return null;
}

function tryJson(text) {
  if (!text) return null;
  const candidates = [text, ...(text.match(/```(?:json)?\s*([\s\S]*?)```/g) ?? []).map((b) => b.replace(/```(?:json)?|```/g, ""))];
  for (const c of candidates) { try { return JSON.parse(c.trim()); } catch { /* next */ } }
  return null;
}

function judge(spec, shape, files) {
  const e = spec.expect ?? {};
  const main = files.find((f) => f.text)?.text ?? shape?.text ?? "";
  const out = { mainSource: files.find((f) => f.text) ? "file" : "reply", mainWords: words(main) };
  if (e.words) out.wordsInRange = out.mainWords >= e.words[0] && out.mainWords <= e.words[1];
  if (e.items) out.listItems = shape?.listItems ?? 0;
  if (e.sections) out.headings = shape?.headings ?? 0;
  if (e.table) out.tables = shape?.tables ?? [];
  if (e.file) out.fileProduced = files.length > 0;
  if (e.total) out.totalMentioned = main.includes(e.total);
  if (e.json) {
    const parsed = tryJson(files.find((f) => f.ext === "json")?.text ?? null) ?? tryJson(shape?.codeText) ?? tryJson(shape?.text);
    out.jsonParses = parsed !== null;
    if (spec.id === "08a" && Array.isArray(parsed)) out.jsonShapeOk = parsed.length === 3 && parsed.every((p) => typeof p.price === "number" && typeof p.inStock === "boolean");
    if (spec.id === "08b" && parsed && typeof parsed === "object") {
      out.jsonShapeOk = typeof parsed.order_id === "string" && typeof parsed.customer?.name === "string" && typeof parsed.customer?.email === "string" &&
        Array.isArray(parsed.items) && parsed.items.length >= 2 && parsed.items.every((i) => typeof i.sku === "string" && Number.isInteger(i.qty) && typeof i.unit_price === "number") &&
        ["pending", "paid", "shipped"].includes(parsed.status);
    }
  }
  return out;
}

async function oneRun(browser, spec, attempt) {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await context.addInitScript(streamProbe);
  try { return await runIn(context, spec, attempt); }
  finally {
    // Keep the rolling login session fresh for the next run (same file, mode 600).
    await context.storageState({ path: STATE }).then(() => chmodSync(STATE, 0o600)).catch(() => {});
    await context.close().catch(() => {});
  }
}

// Loads /chat. A load the browser aborts before anything is sent (seen twice in
// pass 1 as net::ERR_ABORTED) is retried here; it creates no chat and sends no
// prompt, so it is not a run retry.
async function openChat(page) {
  for (let i = 1; ; i++) {
    try { return await page.goto(`${BASE}/chat`, { waitUntil: "domcontentloaded" }); }
    catch (err) {
      if (i >= 3 || !/ERR_ABORTED/.test(String(err?.message))) throw err;
      log(`  /chat load aborted (try ${i}), loading again in 5 s`);
      await sleep(5000);
    }
  }
}

async function runIn(context, spec, attempt) {
  const tag = `p${PASS}-${spec.id}${attempt > 1 ? "-retry" : ""}`;
  const prompt = matrix.prefix + spec.prompt;
  const rec = { pass: PASS, id: spec.id, attempt, format: spec.format, level: spec.level, prompt, startedAt: new Date().toISOString() };
  const authHits = [];
  const httpErrors = [];
  const page = await context.newPage();
  page.on("response", (r) => {
    const u = new URL(r.url());
    if (u.origin !== new URL(BASE).origin) return;
    const s = r.status();
    if (s === 401 || s === 403) authHits.push({ status: s, path: u.pathname });
    else if (s >= 400 && u.pathname.startsWith("/api/")) httpErrors.push({ status: s, path: u.pathname });
  });
  const thinking = new Map();
  try {
    await openChat(page);
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    if (!page.url().startsWith(BASE) || new URL(page.url()).pathname.startsWith("/auth")) throw new Halt("auth", `sent to login (${new URL(page.url()).pathname})`);
    if (authHits.length) throw new Halt("auth", `HTTP ${authHits[0].status} on ${authHits[0].path} while loading`);
    const box = page.locator("textarea").first();
    await box.waitFor({ state: "visible", timeout: 20000 });
    await box.fill(prompt);
    await page.locator('button[aria-label="Send message"]').first().click();
    const t0 = Date.now();
    rec.sentAt = new Date(t0).toISOString();

    // Wait for the stream to end and the UI to settle, sampling thinking text.
    let done = false;
    let idleSince = null;
    let lastStopCheck = 0;
    while (!done) {
      const now = Date.now();
      if (now - lastStopCheck > 5000) { lastStopCheck = now; if (existsSync(STOP)) throw new Halt("stop-file", "STOP file found mid-run"); }
      if (authHits.length) throw new Halt("auth", `HTTP ${authHits[0].status} on ${authHits[0].path}`);
      const texts = await page.evaluate(thinkingTexts).catch(() => []);
      for (const t of texts) {
        const cur = thinking.get(t);
        if (cur) cur.last = now - t0; else thinking.set(t, { first: now - t0, last: now - t0 });
      }
      const st = await page.evaluate(() => {
        const ss = window.__loop?.streams ?? [];
        return { n: ss.length, open: ss.some((s) => s.tEnd === null), stopBtn: !!document.querySelector('button[aria-label="Stop generation"]') };
      });
      if (st.n > 0 && !st.open && !st.stopBtn) {
        idleSince ??= now;
        if (now - idleSince > 2500) done = true;
      } else idleSince = null;
      if (now - t0 > RUN_TIMEOUT_MS) {
        rec.timedOut = true;
        await page.locator('button[aria-label="Stop generation"]').first().click({ timeout: 3000 }).catch(() => {});
        break;
      }
      await sleep(SAMPLE_MS);
    }
    await sleep(1500);

    const streams = await page.evaluate(() => window.__loop?.streams ?? []);
    const s = streams[0] ?? null;
    const events = streams.flatMap((x) => x.events);
    rec.stream = s && {
      url: s.url, status: s.status,
      firstByteMs: s.tFirstByte && s.tFirstByte - s.tSend,
      firstTextMs: s.tFirstText && s.tFirstText - s.tSend,
      totalMs: s.tEnd && s.tEnd - s.tSend,
      textChars: streams.reduce((n, x) => n + x.textChars, 0),
      heartbeats: streams.reduce((n, x) => n + x.heartbeats, 0),
      parseErrors: streams.reduce((n, x) => n + x.parseErrors, 0),
      streamsSeen: streams.length,
    };
    rec.runErrors = events.filter((e) => e.type === "RUN_ERROR");
    rec.runFinished = events.some((e) => e.type === "RUN_FINISHED");
    rec.httpErrors = httpErrors;
    rec.toolCalls = events.filter((e) => e.type === "TOOL_CALL_START").map((e) => e.tool);
    rec.model = events.filter((e) => e.name === "model_selected").map((e) => e.model ?? e.model_name ?? e.model_id ?? e.raw);
    rec.customEvents = Object.entries(events.filter((e) => e.type === "CUSTOM").reduce((m, e) => ((m[e.name] = (m[e.name] ?? 0) + 1), m), {})).map(([name, n]) => ({ name, n }));
    rec.reasoningHeadings = events.filter((e) => e.name === "reasoning_heading").map((e) => ({ atMs: e.t - (s?.tSend ?? 0), text: e.heading ?? e.text }));
    rec.docxProgress = events.filter((e) => e.name === "docx_progress").map((e) => ({ atMs: e.t - (s?.tSend ?? 0), step: e.step, message: e.message, filename: e.filename }));
    rec.generatedFiles = events.filter((e) => e.name === "generated_file").map((e) => ({ filename: e.filename, mime: e.mime_type }));
    rec.thinkingShown = [...thinking.entries()].map(([text, v]) => ({ text, firstMs: v.first, lastMs: v.last, shownMs: v.last - v.first + SAMPLE_MS }));
    rec.awaitingInput = events.some((e) => /_prompt$/.test(e.name ?? ""));
    if (rec.runErrors.some((e) => /401|403|token expired|invalid token|unauthori[sz]ed|forbidden/i.test(e.message))) {
      throw new Halt("auth", `RUN_ERROR: ${rec.runErrors[0].message.slice(0, 200)}`);
    }

    const shape = await page.evaluate(replyShape);
    rec.chatUrl = page.url().replace(BASE, "");

    // Screenshots: the page as seen, then the whole reply at full height.
    await page.screenshot({ path: resolve(passDir, `${tag}-page.png`), fullPage: true });
    const last = page.locator('[data-message-id][role="article"]').last();
    if (await last.count()) {
      const h = Math.min(16000, Math.ceil((await last.boundingBox())?.height ?? 900) + 300);
      await page.setViewportSize({ width: 1440, height: Math.max(900, h) });
      await sleep(400);
      await last.screenshot({ path: resolve(passDir, `${tag}-reply.png`) }).catch(() => {});
      await page.setViewportSize({ width: 1440, height: 900 });
    }

    // Generated files: try the "View" preview, then save the file itself.
    const files = [];
    for (const [i, d] of (shape?.downloadLinks ?? []).slice(0, 2).entries()) {
      const name = d.download ?? `file-${i}`;
      const ext = (name.split(".").pop() ?? "").toLowerCase();
      const f = { filename: name, ext };
      const view = page.locator('[data-message-id][role="article"]').last().locator('a[aria-label="View"]').nth(i);
      const popupP = context.waitForEvent("page", { timeout: 8000 }).catch(() => null);
      const dlP = page.waitForEvent("download", { timeout: 8000 }).catch(() => null);
      await view.click({ timeout: 5000 }).catch(() => {});
      const [popup, dl] = await Promise.all([popupP, dlP]);
      if (popup) {
        await popup.waitForLoadState("load", { timeout: 15000 }).catch(() => {});
        await sleep(2500);
        f.preview = { opened: true, host: new URL(popup.url()).host || popup.url().slice(0, 30) };
        await popup.screenshot({ path: resolve(passDir, `${tag}-preview-${i}.png`) }).catch(() => { f.preview.screenshot = "failed"; });
        await popup.close().catch(() => {});
      } else f.preview = { opened: false, downloadedInstead: !!dl };
      const res = await page.request.get(`${BASE}${d.href}`, { timeout: 30000 }).catch(() => null);
      if (res?.ok()) {
        const buf = await res.body();
        const path = resolve(passDir, "files", `${tag}-${name.replace(/[^\w.-]+/g, "_")}`);
        writeFileSync(path, buf);
        f.bytes = buf.length;
        f.contentType = res.headers()["content-type"];
        f.text = fileText(path, ext);
        f.words = f.text ? words(f.text) : null;
      } else f.fetch = res ? `HTTP ${res.status()}` : "failed";
      files.push(f);
    }
    rec.files = files.map(({ text, ...rest }) => rest);
    rec.reply = shape && { words: words(shape.text), headings: shape.headings, listItems: shape.listItems, tables: shape.tables,
      codeBlocks: shape.codeBlocks, fileChips: shape.fileChips.length, artifactCards: shape.artifactCards, excerpt: shape.text.slice(0, 400) };
    rec.check = judge(spec, shape, files);
    rec.documentRendered = files.length > 0 || (shape?.artifactCards ?? 0) > 0 || (shape?.headings ?? 0) > 0 || (shape?.tables.length ?? 0) > 0;
    rec.previewOpened = files.length ? files.some((f) => f.preview?.opened) : null;
    rec.screenshots = { page: `pass-${PASS}/${tag}-page.png`, reply: `pass-${PASS}/${tag}-reply.png` };

    const failed = rec.timedOut || rec.runErrors.length > 0 || !s || (s.status !== 200 && s.status !== null) || (rec.stream.textChars === 0 && files.length === 0);
    rec.outcome = failed ? "failed" : "ok";
    rec.failure = failed ? (rec.timedOut ? "timeout" : rec.runErrors.length ? "run-error" : !s ? "no-stream" : s.status !== 200 ? `http-${s.status}` : "empty") : null;
  } catch (err) {
    if (err instanceof Halt) { rec.outcome = "halted"; rec.failure = `${err.kind}: ${err.message}`; appendRecord(rec); await page.close().catch(() => {}); throw err; }
    rec.outcome = "failed";
    rec.failure = `harness: ${String(err?.message ?? err).slice(0, 300)}`;
    await page.screenshot({ path: resolve(passDir, `${tag}-page.png`), fullPage: true }).catch(() => {});
  }
  appendRecord(rec);
  await page.close().catch(() => {});
  return rec;
}

function appendRecord(rec) {
  rec.finishedAt = new Date().toISOString();
  appendFileSync(RUNS, JSON.stringify(rec) + "\n");
  log(`${rec.id}#${rec.attempt} ${rec.outcome}${rec.failure ? ` (${rec.failure})` : ""}` +
    (rec.stream ? ` first text ${rec.stream.firstTextMs ?? "-"} ms, total ${rec.stream.totalMs ?? "-"} ms` : "") +
    (rec.model?.length ? `, model ${rec.model.join("/")}` : ""));
}

// ── Main ──
if (!existsSync(STATE)) { console.error("No saved session. Run scripts/doc-gen-loop/login.mjs first."); process.exit(1); }
if (existsSync(STOP)) { console.error("STOP file present; remove it to run."); process.exit(1); }

let appCommit = null;
try { appCommit = execFileSync("git", ["-C", APP_DIR, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim(); } catch { /* unknown */ }
writeFileSync(resolve(passDir, "meta.json"), JSON.stringify({ pass: PASS, base: BASE, appDir: APP_DIR, appCommit, startedAt: new Date().toISOString(),
  backend: "https://devapi.getsouvenir.com (via the local /api proxy)", model: "account default" }, null, 2) + "\n");

const browser = await chromium.launch({ headless: !HEADED });

const prior = existsSync(RUNS) ? readFileSync(RUNS, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.pass === PASS) : [];
// Finished = ok, or failed twice after sending. Harness-side failures sent nothing
// to the backend, so they don't count against the one-retry rule.
const sentFailures = (id) => prior.filter((r) => r.id === id && r.outcome === "failed" && !String(r.failure).startsWith("harness") && r.sentAt).length;
const finished = new Set(prior.filter((r) => r.outcome === "ok" || sentFailures(r.id) >= 2).map((r) => r.id));
const plan = matrix.runs.filter((r) => (!ONLY.length || ONLY.includes(r.id)) && !finished.has(r.id));
if (finished.size) log(`skipping ${finished.size} finished run(s): ${[...finished].join(", ")}`);
let lastStart = prior.length ? Date.parse(prior[prior.length - 1].startedAt) : 0;
let exitCode = 0;
try {
  for (const spec of plan) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      if (runsSoFar() >= MAX_RUNS) throw new Halt("cap", `${MAX_RUNS} runs reached`);
      if (lastStart) await waitWithStop(Math.max(0, lastStart + SPACING_MS - Date.now()));
      if (existsSync(STOP)) throw new Halt("stop-file", "STOP file found");
      lastStart = Date.now();
      log(`run ${spec.id} (${spec.format}, ${spec.level}) attempt ${attempt}`);
      const rec = await oneRun(browser, spec, attempt);
      if (rec.outcome !== "failed") break;
    }
  }
  log("pass complete");
} catch (err) {
  if (err instanceof Halt) { stopped(err.kind, err.message); exitCode = 2; } else { console.error(err); exitCode = 1; }
} finally {
  await browser.close().catch(() => {});
}
process.exit(exitCode);
