export function createQueue({ handler, onError }) {
  const pending = [];
  const queued = new Set();
  let activeId = null;
  let pumping = false;
  let paused = false;
  let pauseReason = null;
  const idleWaiters = [];

  function notifyIdle() {
    if (!pumping && pending.length === 0 && !activeId) {
      while (idleWaiters.length) idleWaiters.shift()();
    }
  }

  async function pump() {
    if (pumping || paused) return;
    pumping = true;
    try {
      while (pending.length && !paused) {
        const job = pending.shift();
        queued.delete(job.id);
        activeId = job.id;
        try {
          await handler(job);
        } catch (error) {
          if (onError) {
            try {
              await onError(job, error);
            } catch {
              // The queue keeps running after a logging failure.
            }
          }
        } finally {
          activeId = null;
        }
      }
    } finally {
      pumping = false;
      notifyIdle();
      if (pending.length && !paused) {
        pump();
      }
    }
  }

  return {
    enqueue(job) {
      if (!job?.id) return { accepted: false, reason: 'invalid_job' };
      if (queued.has(job.id) || activeId === job.id) {
        return { accepted: false, reason: 'duplicate_job' };
      }
      queued.add(job.id);
      pending.push(job);
      pump();
      return { accepted: true };
    },
    has(id) {
      return queued.has(id) || activeId === id;
    },
    position(id) {
      if (activeId === id) return 1;
      const index = pending.findIndex((job) => job.id === id);
      if (index === -1) return null;
      return index + (activeId ? 2 : 1);
    },
    pause(reason = 'paused') {
      paused = true;
      pauseReason = reason;
    },
    resume() {
      if (!paused) return;
      paused = false;
      pauseReason = null;
      pump();
    },
    get paused() {
      return paused;
    },
    get pauseReason() {
      return pauseReason;
    },
    whenIdle() {
      if (!pumping && pending.length === 0 && !activeId) return Promise.resolve();
      return new Promise((resolve) => idleWaiters.push(resolve));
    },
    get length() {
      return pending.length + (activeId ? 1 : 0);
    },
    get activeId() {
      return activeId;
    },
  };
}
