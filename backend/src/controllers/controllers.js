import { isValidInviteLink } from '../config/index.js';
import { HttpError } from '../httpError.js';

export function createRegistrationController(registrations) {
  return {
    async create(req, res) {
      const registration = await registrations.create(req.body || {});
      res.status(201).json({ registration });
    },
    async getOne(req, res) {
      const registration = await registrations.getPublic(req.params.id);
      res.json({ registration });
    },
  };
}

export function createPaymentController(payments) {
  return {
    async createOrder(req, res) {
      const registrationId = req.body?.registrationId;
      if (!registrationId) {
        throw new HttpError(400, 'validation_error', 'A registration id is required.', {
          fields: { registrationId: 'A registration id is required.' },
        });
      }
      const order = await payments.createOrder(registrationId);
      res.status(201).json(order);
    },
    async verify(req, res) {
      const result = await payments.verifyCheckout({
        registrationId: req.body?.registrationId,
        orderId: req.body?.razorpay_order_id,
        paymentId: req.body?.razorpay_payment_id,
        signature: req.body?.razorpay_signature,
      });
      res.json({
        verified: true,
        duplicate: result.duplicate,
        registrationId: result.registration.id,
        status: result.registration.status,
      });
    },
    async webhook(req, res) {
      const result = await payments.handleWebhook(req.body, req.get('x-razorpay-signature'));
      res.json(result);
    },
  };
}

export function createAdminController({ registrations, store, config, automation, queue }) {
  return {
    async list(req, res) {
      res.json(await registrations.listAdmin({ q: req.query.q || '' }));
    },
    async getOne(req, res) {
      res.json({ registration: await registrations.getAdmin(req.params.id) });
    },
    async retry(req, res) {
      res.json({ registration: await registrations.retry(req.params.id) });
    },
    async review(req, res) {
      res.json({ registration: await registrations.review(req.params.id) });
    },
    async admit(req, res) {
      res.json({ registration: await registrations.admit(req.params.id) });
    },
    async confirm(req, res) {
      res.json({
        registration: await registrations.confirm(req.params.id, req.body?.confirmedInGroup),
      });
    },
    async getSettings(_req, res) {
      res.json({ settings: await store.getSettings() });
    },
    async updateSettings(req, res) {
      const inviteLink = String(req.body?.inviteLink || '').trim();
      const groupName = String(req.body?.groupName || '').trim();
      const admissionMode = req.body?.admissionMode === 'approval' ? 'approval' : 'invite';
      if (inviteLink && !isValidInviteLink(inviteLink)) {
        throw new HttpError(400, 'validation_error', 'Use an https://chat.whatsapp.com/ invitation link.', {
          fields: { inviteLink: 'Use an https://chat.whatsapp.com/ invitation link.' },
        });
      }
      if (groupName.length > 80) {
        throw new HttpError(400, 'validation_error', 'Group name must be 80 characters or fewer.', {
          fields: { groupName: 'Group name must be 80 characters or fewer.' },
        });
      }
      const settings = await store.saveSettings({
        inviteLink,
        groupName,
        admissionMode,
        inviteLinkUpdatedAt: new Date().toISOString(),
      });
      await store.addLog({ level: 'info', event: 'settings_updated', detail: { admissionMode } });
      res.json({
        settings,
        notice: 'If a previous invitation link was shared too widely, revoke it in WhatsApp before relying on the new one. Revoking makes the old link stop working.',
      });
    },
    async automationStatus(_req, res) {
      const worker = automation?.getStatus() || {
        session: 'disabled',
        checking: false,
        lastError: null,
        lastCheckedAt: null,
        screenshotAvailable: false,
        activity: 'Waiting',
      };
      res.json({
        ...worker,
        queueLength: queue.length,
        activeJobId: queue.activeId,
        queuePaused: queue.paused,
        queuePauseReason: queue.pauseReason,
        directAddEnabled: config.directAddEnabled,
        automationEnabled: config.automationEnabled,
      });
    },
    async resumeQueue(_req, res) {
      await store.saveSettings({ queuePaused: false, queuePauseReason: null });
      queue.resume();
      await store.addLog({
        level: 'info',
        event: 'queue_resumed',
        detail: { queueLength: queue.length },
      });
      res.json({
        paused: queue.paused,
        queueLength: queue.length,
        message: 'Adding continues, one registration at a time.',
      });
    },
    async openSession(_req, res) {
      if (!config.automationEnabled || !automation) {
        throw new HttpError(503, 'automation_disabled', 'Browser automation is disabled.');
      }
      automation.triggerSessionCheck();
      res.status(202).json({
        message: 'WhatsApp is opening. Use Show scanner if you need to link an account.',
      });
    },
    async logoutWhatsApp(_req, res) {
      if (!config.automationEnabled || !automation?.logout) {
        throw new HttpError(503, 'automation_disabled', 'Browser automation is disabled.');
      }
      if (queue.activeId) {
        throw new HttpError(409, 'busy', 'A group add is running. Wait until it finishes, then log out.');
      }
      await automation.logout();
      automation.triggerSessionCheck();
      await store.addLog({ level: 'info', event: 'whatsapp_logged_out' });
      res.json({ message: 'WhatsApp was logged out. Scan the new code with the account you want to use.' });
    },
    async refreshSession(_req, res) {
      if (!config.automationEnabled || !automation?.refreshShot) {
        throw new HttpError(503, 'automation_disabled', 'Browser automation is disabled.');
      }
      if (queue.activeId || automation.getStatus().checking) {
        res.json({ skipped: true });
        return;
      }
      await automation.refreshShot();
      res.json({ session: automation.getStatus().session });
    },
    async screenshot(_req, res) {
      const activity = automation?.liveActivity?.() || 'Waiting';
      res.set('Cache-Control', 'no-store');
      res.set('X-WhatsApp-Activity', activity);
      const live = automation?.liveFrame?.();
      if (live?.length) {
        res.type('image/jpeg').send(live);
        return;
      }
      const file = automation?.screenshotFile?.();
      if (!file) throw new HttpError(404, 'not_found', 'No browser screenshot is available yet.');
      res.sendFile(file);
    },
    async qr(_req, res) {
      const file = automation?.qrFile?.();
      if (!file) throw new HttpError(404, 'not_found', 'No scanner code is available yet.');
      res.sendFile(file);
    },
    async logs(_req, res) {
      res.json({ logs: await store.listLogs(100) });
    },
  };
}
