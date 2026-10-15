import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { browserFailureCode, classifyLoginSignals } from '../src/automation/loginState.js';
import { processMembership } from '../src/automation/membership.js';

const baseRegistration = {
  id: 'reg_test',
  name: 'Group Test',
  phoneE164: '+14155550100',
  paymentStatus: 'not_required',
  attempts: 0,
};

const settings = {
  inviteLink: 'https://chat.whatsapp.com/InviteCode123',
  admissionMode: 'invite',
  groupName: 'Members',
};

describe('WhatsApp login state', () => {
  it('classifies the chat list, the QR code, and an unknown page', () => {
    assert.equal(classifyLoginSignals({ hasChatList: true, hasQr: true }), 'authenticated');
    assert.equal(classifyLoginSignals({ hasChatList: false, hasQr: true }), 'qr_required');
    assert.equal(classifyLoginSignals({ hasChatList: false, hasQr: false }), 'unknown');
  });

  it('maps a missing browser install separately from a crash', () => {
    assert.equal(browserFailureCode(new Error("Executable doesn't exist")), 'browser_not_installed');
    assert.equal(browserFailureCode(new Error('target closed')), 'browser_crash');
  });
});

describe('membership outcomes', () => {
  it('uses the invitation link when direct add is off', async () => {
    const result = await processMembership({
      registration: baseRegistration,
      settings,
      config: { paymentsEnabled: false, directAddEnabled: false },
      whatsapp: null,
    });
    assert.equal(result.status, 'invite_ready');
    assert.equal(result.action, 'invite_link');
  });

  it('falls back to the invitation link when the number cannot be selected', async () => {
    const result = await processMembership({
      registration: baseRegistration,
      settings,
      config: { paymentsEnabled: false, directAddEnabled: true },
      whatsapp: {
        async checkSession() {
          return { state: 'authenticated' };
        },
        async tryAddParticipant() {
          return {
            outcome: 'not_selectable',
            reason: 'contact_not_saved',
            contact: { saved: false, reason: 'contact_not_accepted' },
          };
        },
      },
    });
    assert.equal(result.status, 'invite_ready');
    assert.equal(result.action, 'direct_add_unavailable');
    assert.equal(result.retryable, false);
    assert.equal(result.contactSaved, false);
    assert.equal(result.contactSavedName, 'Group Test');
  });

  it('keeps the person in line when WhatsApp Web is waiting for a QR scan', async () => {
    const result = await processMembership({
      registration: baseRegistration,
      settings,
      config: { paymentsEnabled: false, directAddEnabled: true },
      whatsapp: {
        async checkSession() {
          return { state: 'qr_required' };
        },
      },
    });
    assert.equal(result.status, 'processing');
    assert.equal(result.holdForLogin, true);
    assert.equal(result.pauseQueue, true);
    assert.equal(result.pauseReason, 'qr_login_required');
    assert.equal(result.retryable, false);
  });

  it('records a retryable browser failure without confirming membership', async () => {
    const result = await processMembership({
      registration: baseRegistration,
      settings,
      config: { paymentsEnabled: false, directAddEnabled: true },
      whatsapp: {
        async checkSession() {
          throw new Error('browser closed');
        },
      },
    });
    assert.equal(result.status, 'failed');
    assert.equal(result.failureCode, 'browser_crash');
    assert.equal(result.retryable, true);
  });

  it('lets an administrator retry when the group chat did not open', async () => {
    const result = await processMembership({
      registration: baseRegistration,
      settings,
      config: { paymentsEnabled: false, directAddEnabled: true },
      whatsapp: {
        async checkSession() {
          return { state: 'authenticated' };
        },
        async tryAddParticipant() {
          return {
            outcome: 'ui_unavailable',
            reason: 'group_not_found',
            contact: { saved: true, reason: 'contact_visible' },
          };
        },
      },
    });
    assert.equal(result.status, 'invite_ready');
    assert.equal(result.actionNote, 'contact_visible; group_not_found');
    assert.equal(result.contactSaved, true);
    assert.equal(result.retryable, true);
  });

  it('sends the group invitation when WhatsApp cannot add the contact directly', async () => {
    const result = await processMembership({
      registration: baseRegistration,
      settings,
      config: { paymentsEnabled: false, directAddEnabled: true },
      whatsapp: {
        async checkSession() {
          return { state: 'authenticated' };
        },
        async tryAddParticipant() {
          return {
            outcome: 'invite_sent',
            reason: 'private_invite_sent',
            contact: { saved: true, reason: 'contact_visible' },
          };
        },
      },
    });
    assert.equal(result.status, 'invite_ready');
    assert.equal(result.actionNote, 'WhatsApp could not add this contact directly, so the group invitation was sent.');
    assert.equal(result.contactSaved, true);
  });

  it('leaves an add click as awaiting confirmation', async () => {
    const result = await processMembership({
      registration: baseRegistration,
      settings,
      config: { paymentsEnabled: false, directAddEnabled: true },
      whatsapp: {
        async checkSession() {
          return { state: 'authenticated' };
        },
        async tryAddParticipant() {
          return { outcome: 'submitted_unconfirmed' };
        },
      },
    });
    assert.equal(result.status, 'awaiting_confirmation');
    assert.equal(result.action, 'direct_add_attempted');
  });

  it('marks approval-mode groups as pending admission', async () => {
    const result = await processMembership({
      registration: baseRegistration,
      settings: { ...settings, admissionMode: 'approval' },
      config: { paymentsEnabled: false, directAddEnabled: false },
      whatsapp: null,
    });
    assert.equal(result.status, 'pending_admission');
  });

  it('does not run membership before payment', async () => {
    const result = await processMembership({
      registration: { ...baseRegistration, paymentStatus: 'pending' },
      settings,
      config: { paymentsEnabled: true, directAddEnabled: false },
      whatsapp: null,
    });
    assert.equal(result.failureCode, 'payment_required');
  });

  it('pauses the rest of the line when WhatsApp asks to slow down', async () => {
    const result = await processMembership({
      registration: baseRegistration,
      settings,
      config: { paymentsEnabled: false, directAddEnabled: true },
      whatsapp: {
        checkSession: async () => ({ state: 'authenticated' }),
        tryAddParticipant: async () => ({ outcome: 'rate_limited', reason: 'whatsapp_limit' }),
      },
    });
    assert.equal(result.pauseQueue, true);
    assert.equal(result.status, 'invite_ready');
    assert.equal(result.retryable, true);
    assert.equal(result.actionNote, 'whatsapp_limit');
  });
});
