import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

let contextPromise = null;
let chain = Promise.resolve();

function withBrowserLock(fn) {
  const run = chain.then(fn, fn);
  chain = run.then(() => undefined, () => undefined);
  return run;
}

export async function launchContext(dataDir) {
  if (!contextPromise) {
    const profileDir = path.join(dataDir, 'wa-profile');
    await fs.mkdir(profileDir, { recursive: true });
    const headless = process.env.WHATSAPP_HEADLESS === 'true';
    const runningAsRoot = typeof process.getuid === 'function' && process.getuid() === 0;
    const args = ['--disable-dev-shm-usage'];
    if (process.env.WHATSAPP_NO_SANDBOX === 'true' || runningAsRoot) {
      args.push('--no-sandbox', '--disable-setuid-sandbox');
    }
    contextPromise = chromium.launchPersistentContext(profileDir, {
      headless,
      viewport: { width: 1280, height: 800 },
      locale: 'en-US',
      args,
    }).then((context) => {
      context.on('close', () => {
        contextPromise = null;
      });
      return context;
    }).catch((error) => {
      contextPromise = null;
      throw error;
    });
  }
  return contextPromise;
}

export async function closeContext() {
  if (!contextPromise) return;
  const pending = contextPromise;
  contextPromise = null;
  const context = await pending;
  await context.close();
}

export async function resetPersistentProfile(dataDir) {
  return withBrowserLock(async () => {
    await closeContext();
    const profileDir = path.join(dataDir, 'wa-profile');
    await fs.rm(profileDir, { recursive: true, force: true }).catch(async () => {
      await new Promise((resolve) => setTimeout(resolve, 600));
      await fs.rm(profileDir, { recursive: true, force: true });
    });
  });
}

export async function withWhatsAppPage(dataDir, fn) {
  return withBrowserLock(async () => {
    const context = await launchContext(dataDir);
    const page = context.pages()[0] || await context.newPage();
    return fn(page);
  });
}
