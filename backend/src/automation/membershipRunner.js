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
