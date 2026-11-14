// Minimal Chrome DevTools driver (Node 22+, no dependencies): launches the
// cached headless Chromium, talks CDP over the built-in WebSocket, and offers
// evaluate / screenshot / key / mouse helpers. Usage:
//   node tools/cdp.mjs <script.mjs>   — runs the script with `cdp` in scope
// A script is an async function receiving the driver; it ends by returning.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CHROME = process.env.CHROME ?? findChrome();
const PORT = Number(process.env.CDP_PORT ?? '9333');

function findChrome() {
  const candidates = [
    `${process.env.HOME}/.cache/ms-playwright/chromium-1255/chrome-linux/chrome`,
    `${process.env.HOME}/.cache/ms-playwright/chromium-1248/chrome-linux/chrome`,
    `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell`,
    `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell`,
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error('no cached chromium found');
}

export class Cdp {
  constructor(ws, targetId) {
    this.ws = ws;
    this.targetId = targetId;
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
    this.onEvent = null;
    ws.onmessage = (message) => {
      const data = JSON.parse(message.data);
      if (data.id && this.pending.has(data.id)) {
        const { resolve, reject } = this.pending.get(data.id);
        this.pending.delete(data.id);
        if (data.error) reject(new Error(JSON.stringify(data.error)));
        else resolve(data.result);
      } else if (data.method) {
        this.events.push(data);
        if (this.onEvent) this.onEvent(data);
      }
    };
  }

  send(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression, awaitPromise = false) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
    if (result.exceptionDetails) {
      throw new Error(`page exception: ${JSON.stringify(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)}`);
    }
    return result.result.value;
  }

  async screenshot(path, format = 'jpeg', quality = 80) {
    const result = await this.send('Page.captureScreenshot', { format, quality });
    const { writeFileSync } = await import('node:fs');
    writeFileSync(path, Buffer.from(result.data, 'base64'));
    return path;
  }

  async key(type, code, key, keyCode) {
    const params = { type, code, key, windowsVirtualKeyCode: keyCode };
    if (type === 'keyDown' || type === 'keyUp') params.modifiers = 0;
    await this.send('Input.dispatchKeyEvent', params);
  }

  async keyPress(code, key, keyCode) {
    await this.key('keyDown', code, key, keyCode);
    await this.key('keyUp', code, key, keyCode);
  }

  async keyDown(code, key, keyCode) {
    await this.key('keyDown', code, key, keyCode);
  }

  async keyUp(code, key, keyCode) {
    await this.key('keyUp', code, key, keyCode);
  }

  async click(x, y, button = 'left') {
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount: 1 });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount: 1 });
  }

  async mouseMove(x, y) {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async waitFor(expression, timeoutMs = 15000, pollMs = 250) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        if (await this.eval(expression)) return true;
      } catch {
        // Page not ready yet; keep polling.
      }
      await this.sleep(pollMs);
    }
    throw new Error(`timeout waiting for ${expression}`);
  }
}

async function launch(url) {
  const chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    '--no-sandbox',
    '--disable-gpu',
    '--enable-unsafe-swiftshader',
    '--window-size=' + (process.env.WINDOW_SIZE ?? '1280,720'),
    '--hide-scrollbars',
    'about:blank',
  ], { stdio: 'ignore' });
  const base = `http://127.0.0.1:${PORT}`;
  let target = null;
  for (let i = 0; i < 50; i += 1) {
    try {
      const list = await (await fetch(`${base}/json/list`)).json();
      const page = list.find((entry) => entry.type === 'page');
      if (page) {
        target = page;
        break;
      }
    } catch {
      // Chrome still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!target) {
    chrome.kill();
    throw new Error('chrome did not start a debuggable page');
  }
  await fetch(`${base}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' }).catch(() => {});
  // Re-list to find the new target.
  let pageTarget = null;
  for (let i = 0; i < 20; i += 1) {
    const list = await (await fetch(`${base}/json/list`)).json();
    pageTarget = list.find((entry) => entry.type === 'page' && entry.url.includes('localhost'));
    if (pageTarget) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!pageTarget) pageTarget = target;
  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  const cdp = new Cdp(ws, pageTarget.id);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Log.enable');
  cdp.kill = () => {
    try { ws.close(); } catch { /* ignore */ }
    chrome.kill();
  };
  return cdp;
}

const scriptPath = process.argv[2];
if (!scriptPath) {
  console.error('usage: node tools/cdp.mjs <script.mjs> [url]');
  process.exit(2);
}
const url = process.argv[3] ?? 'http://localhost:8080/';
const { resolve } = await import('node:path');
const { pathToFileURL } = await import('node:url');
const script = await import(pathToFileURL(resolve(process.cwd(), scriptPath)).href);
const cdp = await launch(url);
try {
  await script.default(cdp);
} finally {
  cdp.kill();
}
