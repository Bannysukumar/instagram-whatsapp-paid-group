import { HttpError } from '../httpError.js';
import { buildRegistration, publicView, adminView, canRetryRegistration } from '../models/registration.js';
import { normalizePhone } from '../phone.js';
import { sanitizeEmail, sanitizeName } from './sanitize.js';

async function present(store, registration, queue) {
  const settings = await store.getSettings();
  const queueInfo = registration.status === 'processing' && queue
    ? { position: queue.position(registration.id), paused: queue.paused, pauseReason: queue.pauseReason }
    : null;
  return publicView(registration, settings.inviteLink, queueInfo);
}

export function createRegistrationService({ store, queue, config }) {
  return {
    async create(input) {
      const name = sanitizeName(input?.name);
      const phone = normalizePhone(input?.phone);
      const email = sanitizeEmail(input?.email);
      const fields = {};
      if (!name.ok) fields.name = name.message;
      if (!phone.ok) fields.phone = phone.message;
      if (!email.ok) fields.email = email.message;
      if (input?.consent !== true) {
        fields.consent = 'Consent is required before this registration can be saved.';
      }
      if (Object.keys(fields).length) {
        throw new HttpError(400, 'validation_error', 'Check the highlighted fields.', { fields });
      }

      const existing = await store.getByPhone(phone.e164);
      if (existing) {
        throw new HttpError(
          409,
          'duplicate_registration',
          'This WhatsApp number has already been registered.',
          { registrationId: existing.id },
        );
      }

      const record = buildRegistration({
        name: name.name,
        phoneE164: phone.e164,
        email: email.email,
        paymentsEnabled: config.paymentsEnabled,
      });

      try {
        await store.createRegistration(record);
      } catch (error) {
        if (error.code === 'duplicate_registration') {
          throw new HttpError(
            409,
            'duplicate_registration',
            'This WhatsApp number has already been registered.',
            { registrationId: error.existing?.id },
          );
        }
        if (error.code === 'database_unavailable') {
          throw new HttpError(503, 'database_unavailable', 'The database is unavailable. Try again shortly.');
        }
        throw error;
      }

      await store.addLog({
        level: 'info',
        event: 'registration_created',
        registrationId: record.id,
        detail: { status: record.status },
      });

      if (!config.paymentsEnabled) {
        queue.enqueue({ id: record.id, type: 'membership' });
      }
      return present(store, record, queue);
    },

    async getPublic(id) {
      const registration = await store.getRegistration(id);
      if (!registration) throw new HttpError(404, 'not_found', 'Registration not found.');
      return present(store, registration, queue);
    },

    async listAdmin({ q }) {
      const [registrations, stats] = await Promise.all([
        store.listRegistrations({ q, limit: 500 }),
        store.stats(),
      ]);
      return { registrations: registrations.map(adminView), stats };
    },

    async getAdmin(id) {
      const registration = await store.getRegistration(id);
      if (!registration) throw new HttpError(404, 'not_found', 'Registration not found.');
      return adminView(registration);
    },

    async retry(id) {
      const registration = await store.getRegistration(id);
      if (!registration) throw new HttpError(404, 'not_found', 'Registration not found.');
      if (!canRetryRegistration(registration)) {
        throw new HttpError(400, 'not_retryable', 'Only a task marked as safe to retry can be queued again.');
      }
      if (config.paymentsEnabled && registration.paymentStatus !== 'verified') {
        throw new HttpError(400, 'payment_required', 'Payment must be verified before this task can run.');
      }
      if (queue.has(registration.id)) {
        throw new HttpError(409, 'duplicate_job', 'This registration is already queued.');
      }
      await store.updateRegistration(registration.id, {
        status: 'processing',
        failureCode: null,
        failureMessage: null,
        retryable: false,
      });
      const queued = queue.enqueue({ id: registration.id, type: 'membership' });
      if (!queued.accepted) {
        throw new HttpError(409, 'duplicate_job', 'This registration is already queued.');
      }
      await store.addLog({
        level: 'info',
        event: 'retry_queued',
        registrationId: registration.id,
        detail: {},
      });
      return this.getAdmin(registration.id);
    },

    async review(id) {
      const registration = await store.getRegistration(id);
      if (!registration) throw new HttpError(404, 'not_found', 'Registration not found.');
      await store.updateRegistration(id, { adminReview: 'reviewed' });
      await store.addLog({ level: 'info', event: 'marked_reviewed', registrationId: id, detail: {} });
      return this.getAdmin(id);
    },

    async admit(id) {
      const registration = await store.getRegistration(id);
      if (!registration) throw new HttpError(404, 'not_found', 'Registration not found.');
      const allowed = ['invite_ready', 'pending_admission', 'awaiting_confirmation'];
      if (!allowed.includes(registration.status)) {
        throw new HttpError(400, 'not_admittable', 'This registration is not ready for an admission note.');
      }
      await store.updateRegistration(id, {
        status: 'awaiting_confirmation',
        adminReview: 'admitted',
        action: registration.action || 'manual_admission',
        failureCode: null,
        failureMessage: null,
        retryable: false,
      });
      await store.addLog({
        level: 'info',
        event: 'marked_awaiting_confirmation',
        registrationId: id,
        detail: {},
      });
      return this.getAdmin(id);
    },

    async confirm(id, confirmedInGroup) {
      if (confirmedInGroup !== true) {
        throw new HttpError(
          400,
          'confirmation_required',
          'Confirm only after you have seen this person in the group.',
        );
      }
      const registration = await store.getRegistration(id);
      if (!registration) throw new HttpError(404, 'not_found', 'Registration not found.');
      const allowed = ['invite_ready', 'pending_admission', 'awaiting_confirmation'];
      if (!allowed.includes(registration.status)) {
        throw new HttpError(400, 'not_confirmable', 'This registration cannot be marked confirmed from its current status.');
      }
      await store.updateRegistration(id, {
        status: 'joined_confirmed',
        confirmationSource: 'admin_attestation',
        failureCode: null,
        failureMessage: null,
        retryable: false,
      });
      await store.addLog({
        level: 'info',
        event: 'membership_attested',
        registrationId: id,
        detail: { confirmationSource: 'admin_attestation' },
      });
      return this.getAdmin(id);
    },
  };
}
