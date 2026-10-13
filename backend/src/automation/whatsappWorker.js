import fs from 'node:fs/promises';
import path from 'node:path';
import { withWhatsAppPage } from './browser.js';
import { browserFailureCode } from './loginState.js';
import { detectPageLoginState, tryAddParticipant } from './whatsapp.js';

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
  };
  let checkPromise = null;

  async function runSessionCheck() {
    try {
      const session = await withWhatsAppPage(dataDir, async (page) => {
        const login = await detectPageLoginState(page);
        state.screenshotFile = await saveShot(dataDir, page, 'session.png');
        return login;
      });
      state.session = session;
      state.lastError = null;
      state.lastCheckedAt = new Date().toISOString();
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
      };
    },
    screenshotFile() {
      return state.screenshotFile;
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
        } catch {
          state.screenshotFile = await saveShot(dataDir, page, `error-${Date.now()}.png`).catch(() => state.screenshotFile);
          state.lastError = 'interface_changed';
          return { outcome: 'ui_unavailable', reason: 'interface_changed' };
        }
      });
    },
  };
}
