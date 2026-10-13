import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { assertConfig, loadConfig } from '../config/index.js';
import { closeContext } from '../automation/browser.js';
import { createAutomation } from '../automation/whatsappWorker.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
dotenv.config({ path: path.join(projectRoot, '.env') });

const config = loadConfig();
assertConfig(config);

const automation = createAutomation({ dataDir: config.dataDir });
const result = await automation.checkSession();
console.log(`WhatsApp session: ${result.state}`);

if (result.state === 'authenticated') {
  console.log('The saved browser profile is logged in. You can close this window.');
  await closeContext();
  process.exit(0);
}

console.log('Scan the QR code in the Chromium window. Leave this process running until the chat list appears.');
console.log('The profile is stored in backend/data/wa-profile and is not committed to git.');
await new Promise(() => {});
