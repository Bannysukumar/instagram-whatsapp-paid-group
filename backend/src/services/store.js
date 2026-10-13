import { createFileStore } from './fileStore.js';
import { createMongoStore } from './mongoStore.js';

export async function createStore(config) {
  if (config.database === 'mongo') return createMongoStore(config);
  return createFileStore(config);
}
