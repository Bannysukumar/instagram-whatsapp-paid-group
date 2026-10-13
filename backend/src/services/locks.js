const chains = new Map();

export function withKeyLock(key, fn) {
  const previous = chains.get(key) || Promise.resolve();
  const run = previous.then(fn, fn);
  chains.set(key, run.then(() => undefined, () => undefined));
  return run;
}
