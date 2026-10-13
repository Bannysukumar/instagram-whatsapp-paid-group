import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createApp } from './app.js';
import { assertConfig, loadConfig } from './config/index.js';
import { createQueue } from './automation/queue.js';
import { createMembershipHandler, markJobCrashed, resumeProcessingQueue } from './automation/membershipRunner.js';
import { closeContext } from './automation/browser.js';
import { createRazorpayClient } from './services/paymentService.js';
import { createStore } from './services/store.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
dotenv.config({ path: path.join(projectRoot, '.env') });
if (!process.env.DATA_DIR) {
  process.env.DATA_DIR = path.join(projectRoot, 'backend', 'data');
}

const config = loadConfig();
assertConfig(config);

const store = await createStore(config);
let automation = null;
if (config.automationEnabled) {
  const { createAutomation } = await import('./automation/whatsappWorker.js');
  automation = createAutomation({ dataDir: config.dataDir });
}

const queueRef = {};
const queue = createQueue({
  handler: createMembershipHandler({ store, config, automation, queue: queueRef }),
  onError: (job) => markJobCrashed(store, job),
});
Object.assign(queueRef, queue);

const startupSettings = await store.getSettings();
if (startupSettings.queuePaused) {
  queue.pause(startupSettings.queuePauseReason || 'whatsapp_limit');
}
const resumed = await resumeProcessingQueue(store, queue);

const paymentClient = config.paymentsEnabled ? await createRazorpayClient(config) : null;
const staticDir = path.join(projectRoot, 'frontend', 'dist');
const servingSite = fs.existsSync(path.join(staticDir, 'index.html'));
const app = createApp({
  store,
  queue,
  config,
  paymentClient,
  automation,
  staticDir: servingSite ? staticDir : null,
});

const server = app.listen(config.port, '0.0.0.0', () => {
  console.log(`API listening on http://0.0.0.0:${config.port}`);
  console.log(servingSite
    ? 'Registration page: served from frontend/dist'
    : 'Registration page: not built. Run npm run build in the project folder.');
  console.log(`Payments: ${config.paymentsEnabled ? 'enabled' : 'disabled'}`);
  console.log(`Direct add: ${config.directAddEnabled ? 'best-effort enabled' : 'off, invitation link is used'}`);
  console.log(`Database: ${config.database}`);
  if (resumed) {
    console.log(`Queue: ${resumed} registration${resumed === 1 ? '' : 's'} still waiting${queue.paused ? ', paused until you resume it' : ''}`);
  }
});

async function shutdown() {
  server.close();
  if (config.automationEnabled) {
    await closeContext().catch(() => undefined);
  }
  if (store.close) await store.close().catch(() => undefined);
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
