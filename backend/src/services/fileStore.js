import fs from 'node:fs/promises';
import path from 'node:path';
import { createMemoryStore } from './memoryStore.js';

export async function createFileStore(config) {
  const directory = config.dataDir;
  const file = path.join(directory, 'state.json');
  await fs.mkdir(directory, { recursive: true });

  const memory = createMemoryStore({
    inviteLink: config.groupInviteLink,
    admissionMode: config.admissionMode,
    groupName: config.groupName,
  });

  try {
    const raw = await fs.readFile(file, 'utf8');
    await memory.hydrate(JSON.parse(raw));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      const wrapped = new Error('Database unavailable');
      wrapped.code = 'database_unavailable';
      throw wrapped;
    }
  }

  let chain = Promise.resolve();

  async function persist() {
    const snapshot = memory.exportState();
    const temporary = `${file}.${process.pid}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(snapshot, null, 2));
    await fs.rename(temporary, file);
  }

  function write(method) {
    return (...args) => {
      const run = chain.then(async () => {
        const result = await memory[method](...args);
        await persist();
        return result;
      });
      chain = run.then(() => undefined, () => undefined);
      return run;
    };
  }

  await persist();

  return {
    createRegistration: write('createRegistration'),
    getRegistration: (...args) => memory.getRegistration(...args),
    getByPhone: (...args) => memory.getByPhone(...args),
    getByOrderId: (...args) => memory.getByOrderId(...args),
    updateRegistration: write('updateRegistration'),
    listRegistrations: (...args) => memory.listRegistrations(...args),
    stats: (...args) => memory.stats(...args),
    getSettings: (...args) => memory.getSettings(...args),
    saveSettings: write('saveSettings'),
    addLog: write('addLog'),
    listLogs: (...args) => memory.listLogs(...args),
    recordPayment: write('recordPayment'),
    getPaymentByPaymentId: (...args) => memory.getPaymentByPaymentId(...args),
  };
}
