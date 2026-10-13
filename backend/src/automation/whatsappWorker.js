import fs from 'node:fs/promises';
import path from 'node:path';
import { resetPersistentProfile, withWhatsAppPage } from './browser.js';
import { browserFailureCode } from './loginState.js';
import { detectPageLoginState, readPageLoginState, tryAddParticipant } from './whatsapp.js';

async function saveShot(dataDir, page, filename) {
  const directory = path.join(dataDir, 'screenshots');
  await fs.mkdir(directory, { recursive: true });
  const file = path.join(directory, filename);
  await page.screenshot({ path: file });
  return file;
}

export function createAutomation({ dataDir }) {
  const state = {
    session: 'unknown',
    checking: false,
    lastError: null,
    lastCheckedAt: null,
    screenshotFile: null,
    qrFile: null,
  };
  let checkPromise = null;

  async function saveQr(page) {
    const directory = path.join(dataDir, 'screenshots');
    await fs.mkdir(directory, { recursive: true });
    const file = path.join(directory, 'qr.png');
    const target = page.locator('[data-testid="qrcode"], div[data-ref] canvas, div[data-ref]').first();
    if (!(await target.isVisible().catch(() => false))) return null;
    await target.screenshot({ path: file });
    return file;
  }

  async function storeView(page, login) {
    state.session = login;
    state.screenshotFile = await saveShot(dataDir, page, 'session.png');
    state.qrFile = login === 'qr_required' ? await saveQr(page).catch(() => null) : null;
    state.lastCheckedAt = new Date().toISOString();
    state.lastError = null;
  }

  async function runSessionCheck() {
    try {
      const session = await withWhatsAppPage(dataDir, async (page) => {
        const login = await detectPageLoginState(page);
        await storeView(page, login);
        return login;
      });
      return { state: session };
    } catch (error) {
      state.session = 'error';
      state.lastError = browserFailureCode(error);
      state.lastCheckedAt = new Date().toISOString();
      throw error;
    }
  }

  return {
    getStatus() {
      return {
        session: state.session,
        checking: state.checking,
        lastError: state.lastError,
        lastCheckedAt: state.lastCheckedAt,
        screenshotAvailable: Boolean(state.screenshotFile),
        qrAvailable: Boolean(state.qrFile),
      };
    },
    screenshotFile() {
      return state.screenshotFile;
    },
    qrFile() {
      return state.qrFile;
    },
    async logout() {
      await resetPersistentProfile(dataDir);
      state.session = 'unknown';
      state.qrFile = null;
      state.screenshotFile = null;
      state.lastError = null;
      state.lastCheckedAt = new Date().toISOString();
    },
    async refreshShot() {
      if (state.checking) return { skipped: true };
      state.checking = true;
      try {
        await withWhatsAppPage(dataDir, async (page) => {
          let login = 'unknown';
          if (String(page.url()).includes('web.whatsapp.com')) {
            login = await readPageLoginState(page);
          }
          if (login === 'unknown') login = await detectPageLoginState(page);
          await storeView(page, login);
        });
        return { state: state.session };
      } catch (error) {
        state.session = 'error';
        state.lastError = browserFailureCode(error);
        state.lastCheckedAt = new Date().toISOString();
        throw error;
      } finally {
        state.checking = false;
      }
    },
    triggerSessionCheck() {
      if (checkPromise) return;
      state.checking = true;
      checkPromise = runSessionCheck()
        .catch(() => undefined)
        .finally(() => {
          state.checking = false;
          checkPromise = null;
        });
    },
    checkSession() {
      state.checking = true;
      return runSessionCheck().finally(() => {
        state.checking = false;
      });
    },
    async tryAddParticipant(args) {
      return withWhatsAppPage(dataDir, async (page) => {
        const login = await detectPageLoginState(page);
        state.session = login;
        state.lastCheckedAt = new Date().toISOString();
        if (login !== 'authenticated') {
          state.screenshotFile = await saveShot(dataDir, page, 'session.png').catch(() => state.screenshotFile);
          return { outcome: 'session_required', reason: login };
        }
        try {
          const result = await tryAddParticipant(page, args);
          state.screenshotFile = await saveShot(dataDir, page, 'last-add.png').catch(() => state.screenshotFile);
          return result;
        } catch (error) {
          state.screenshotFile = await saveShot(dataDir, page, `error-${Date.now()}.png`).catch(() => state.screenshotFile);
          const detail = String(error?.message || 'interface_changed').split('\n')[0].slice(0, 160);
          state.lastError = detail;
          return { outcome: 'ui_unavailable', reason: `interface_changed: ${detail}` };
        }
      });
    },
  };
}
