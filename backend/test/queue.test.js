import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createQueue } from '../src/automation/queue.js';
import { continueAfterLogin, resumeLoginHolds, resumeProcessingQueue } from '../src/automation/membershipRunner.js';
import { createMemoryStore } from '../src/services/memoryStore.js';

describe('queue', () => {
  it('runs jobs one at a time and rejects a duplicate id', async () => {
    let active = 0;
    let peak = 0;
    let releaseFirst;
    const firstGate = new Promise((resolve) => {
      releaseFirst = resolve;
    });
    const seen = [];
    const queue = createQueue({
      handler: async (job) => {
        active += 1;
        peak = Math.max(peak, active);
        seen.push(job.id);
        if (job.id === 'reg_a') await firstGate;
        active -= 1;
      },
    });

    assert.deepEqual(queue.enqueue({ id: 'reg_a' }), { accepted: true });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(queue.enqueue({ id: 'reg_a' }), { accepted: false, reason: 'duplicate_job' });
    assert.equal(queue.enqueue({ id: 'reg_b' }).accepted, true);
    releaseFirst();
    await queue.whenIdle();
    assert.equal(peak, 1);
    assert.deepEqual(seen, ['reg_a', 'reg_b']);
  });

  it('keeps a place in line and waits while paused', async () => {
    let releaseFirst;
    const firstGate = new Promise((resolve) => {
      releaseFirst = resolve;
    });
    const seen = [];
    const queue = createQueue({
      handler: async (job) => {
        seen.push(job.id);
        if (job.id === 'reg_a') await firstGate;
      },
    });

    queue.enqueue({ id: 'reg_a' });
    queue.enqueue({ id: 'reg_b' });
    queue.enqueue({ id: 'reg_c' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(queue.position('reg_a'), 1);
    assert.equal(queue.position('reg_b'), 2);
    assert.equal(queue.position('reg_c'), 3);

    queue.pause('whatsapp_limit');
    releaseFirst();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(queue.paused, true);
    assert.deepEqual(seen, ['reg_a']);
    assert.equal(queue.position('reg_b'), 1);
    assert.equal(queue.length, 2);

    queue.resume();
    await queue.whenIdle();
    assert.deepEqual(seen, ['reg_a', 'reg_b', 'reg_c']);
  });

  it('puts unfinished registrations back in line, oldest first, after a restart', async () => {
    const store = createMemoryStore();
    const seen = [];
    const queue = createQueue({
      handler: async (job) => {
        seen.push(job.id);
      },
    });
    await store.createRegistration({
      id: 'reg_new',
      name: 'New',
      phoneE164: '+14155550102',
      status: 'processing',
      createdAt: '2026-02-01T00:00:00.000Z',
    });
    await store.createRegistration({
      id: 'reg_old',
      name: 'Old',
      phoneE164: '+14155550101',
      status: 'processing',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    await store.createRegistration({
      id: 'reg_done',
      name: 'Done',
      phoneE164: '+14155550103',
      status: 'joined_confirmed',
      createdAt: '2025-12-01T00:00:00.000Z',
    });

    const count = await resumeProcessingQueue(store, queue);
    await queue.whenIdle();
    assert.equal(count, 2);
    assert.deepEqual(seen, ['reg_old', 'reg_new']);
  });

  it('continues people who were waiting for a scan once WhatsApp is connected', async () => {
    const store = createMemoryStore();
    const seen = [];
    const queue = createQueue({
      handler: async (job) => {
        seen.push(job.id);
      },
    });
    await store.createRegistration({
      id: 'reg_hold',
      name: 'Hold',
      phoneE164: '+14155550110',
      status: 'processing',
      createdAt: '2026-03-01T00:00:00.000Z',
    });
    await store.createRegistration({
      id: 'reg_old_login',
      name: 'Old login',
      phoneE164: '+14155550111',
      status: 'invite_ready',
      actionNote: 'qr_login_required',
      createdAt: '2026-02-01T00:00:00.000Z',
    });
    queue.pause('qr_login_required');
    const resumed = await continueAfterLogin({
      store,
      queue,
      automation: { async checkSession() { return { state: 'authenticated' }; } },
    });
    await queue.whenIdle();
    assert.equal(resumed, 1);
    assert.deepEqual(seen, ['reg_hold']);
    assert.equal(queue.paused, false);
    await store.updateRegistration('reg_hold', { status: 'joined_confirmed' });

    const broughtBack = await resumeLoginHolds(store, queue);
    await queue.whenIdle();
    assert.equal(broughtBack, 1);
    assert.deepEqual(seen, ['reg_hold', 'reg_old_login']);
  });

  it('does not resume a WhatsApp slow-down pause when the session is connected', async () => {
    const store = createMemoryStore();
    const queue = createQueue({ handler: async () => {} });
    queue.pause('whatsapp_limit');
    const resumed = await continueAfterLogin({
      store,
      queue,
      automation: { async checkSession() { return { state: 'authenticated' }; } },
    });
    assert.equal(resumed, 0);
    assert.equal(queue.paused, true);
    assert.equal(queue.pauseReason, 'whatsapp_limit');
  });
});
