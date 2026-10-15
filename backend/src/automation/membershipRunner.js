import { processMembership } from './membership.js';

export function createMembershipHandler({ store, config, automation, queue }) {
  return async function handleMembership(job) {
    const registration = await store.getRegistration(job.id);
    if (!registration || registration.status !== 'processing') return;

    const settings = await store.getSettings();
    const result = await processMembership({
      registration,
      settings,
      config,
      whatsapp: config.directAddEnabled ? automation : null,
    });

    if (result.holdForLogin) {
      await store.updateRegistration(registration.id, {
        status: 'processing',
        action: result.action,
        actionNote: result.actionNote,
        failureCode: null,
        failureMessage: null,
        retryable: false,
      });
      await store.addLog({
        level: 'info',
        event: 'membership_waiting_for_login',
        registrationId: registration.id,
        detail: { status: 'processing' },
      });
      if (queue && queue.pauseReason !== 'whatsapp_limit') {
        queue.pause('qr_login_required');
        await store.saveSettings({
          queuePaused: true,
          queuePauseReason: 'qr_login_required',
        });
      }
      return;
    }

    await store.updateRegistration(registration.id, {
      status: result.status,
      action: result.action,
      actionNote: result.actionNote,
      failureCode: result.failureCode,
      failureMessage: result.failureMessage,
      retryable: result.retryable,
      attempts: registration.attempts + 1,
      ...(result.confirmationSource ? { confirmationSource: result.confirmationSource } : {}),
      ...(result.contactSavedName !== undefined
        ? {
          contactSavedName: result.contactSavedName,
          contactSaved: result.contactSaved,
          contactSaveReason: result.contactSaveReason,
        }
        : {}),
    });
    await store.addLog({
      level: result.status === 'failed' ? 'error' : 'info',
      event: 'membership_processed',
      registrationId: registration.id,
      detail: {
        status: result.status,
        action: result.action,
        failureCode: result.failureCode,
      },
    });

    if (result.pauseQueue && queue) {
      queue.pause(result.pauseReason || 'whatsapp_limit');
      await store.saveSettings({
        queuePaused: true,
        queuePauseReason: result.pauseReason || 'whatsapp_limit',
      });
      await store.addLog({
        level: 'error',
        event: 'queue_paused',
        registrationId: registration.id,
        detail: { reason: result.pauseReason || 'whatsapp_limit' },
      });
    }
  };
}

export async function resumeProcessingQueue(store, queue) {
  const waiting = await store.listRegistrations({
    status: 'processing',
    limit: 500,
    oldestFirst: true,
  });
  let count = 0;
  for (const row of waiting) {
    if (queue.enqueue({ id: row.id, type: 'membership' }).accepted) count += 1;
  }
  return count;
}

export async function resumeLoginHolds(store, queue) {
  const stalled = await store.listRegistrations({
    status: 'invite_ready',
    limit: 500,
    oldestFirst: true,
  });
  for (const row of stalled) {
    if (row.actionNote !== 'qr_login_required') continue;
    await store.updateRegistration(row.id, {
      status: 'processing',
      actionNote: 'Waiting for the WhatsApp login. This person stays in line.',
      failureCode: null,
      failureMessage: null,
      retryable: false,
    });
  }
  return resumeProcessingQueue(store, queue);
}

let loginTimer = null;
let loginCheckRunning = false;

export function startLoginWatch({ store, queue, automation }) {
  if (loginTimer || !automation?.checkSession) return;
  loginTimer = setInterval(() => {
    continueAfterLogin({ store, queue, automation }).catch(() => {});
  }, 20000);
  if (typeof loginTimer.unref === 'function') loginTimer.unref();
}

export async function continueAfterLogin({ store, queue, automation }) {
  if (loginCheckRunning) return 0;
  if (!queue?.paused || queue.pauseReason !== 'qr_login_required') return 0;
  if (queue.activeId) return 0;
  loginCheckRunning = true;
  try {
    const session = await automation.checkSession();
    if (session?.state !== 'authenticated') return 0;
    await store.saveSettings({ queuePaused: false, queuePauseReason: null });
    const count = await resumeProcessingQueue(store, queue);
    queue.resume();
    return count;
  } catch {
    return 0;
  } finally {
    loginCheckRunning = false;
  }
}

export async function markJobCrashed(store, job) {
  const registration = await store.getRegistration(job.id);
  if (!registration || registration.status !== 'processing') return;
  await store.updateRegistration(job.id, {
    status: 'failed',
    failureCode: 'browser_crash',
    failureMessage: 'The automation task stopped unexpectedly. You can retry it.',
    retryable: true,
    attempts: registration.attempts + 1,
  });
  await store.addLog({
    level: 'error',
    event: 'job_failed',
    registrationId: job.id,
    detail: { failureCode: 'browser_crash' },
  });
}
