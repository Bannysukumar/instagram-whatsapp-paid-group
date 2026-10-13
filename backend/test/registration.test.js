import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import request from 'supertest';
import { createTestContext } from './helpers.js';

async function register(app, body) {
  return request(app).post('/api/registrations').send(body);
}

describe('registration', () => {
  it('validates fields on the server and stores an E.164 number', async () => {
    const { app, queue, store } = createTestContext();
    const invalid = await register(app, { name: 'A', phone: '123', consent: false });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.error.code, 'validation_error');
    assert.ok(invalid.body.error.fields.phone);
    assert.ok(invalid.body.error.fields.consent);

    const created = await register(app, {
      name: 'Ada Lovelace',
      phone: '+44 7911 123456',
      email: 'ada@example.com',
      consent: true,
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.registration.status, 'processing');
    assert.equal(created.body.registration.inviteLink, null);
    assert.equal(created.body.registration.phoneE164, undefined);

    await queue.whenIdle();
    const saved = await store.getRegistration(created.body.registration.id);
    assert.equal(saved.phoneE164, '+447911123456');
    assert.equal(saved.status, 'invite_ready');

    const status = await request(app).get(`/api/registrations/${saved.id}`);
    assert.equal(status.status, 200);
    assert.equal(status.body.registration.inviteLink, 'https://chat.whatsapp.com/InviteCode123');
    assert.equal(status.body.registration.email, undefined);
  });

  it('rejects a duplicate number after normalization', async () => {
    const { app, queue } = createTestContext();
    const first = await register(app, {
      name: 'Grace Hopper',
      phone: '+14155550100',
      consent: true,
    });
    assert.equal(first.status, 201);
    const second = await register(app, {
      name: 'Grace H.',
      phone: '+1 415 555 0100',
      consent: true,
    });
    assert.equal(second.status, 409);
    assert.equal(second.body.error.code, 'duplicate_registration');
    assert.equal(second.body.error.registrationId, first.body.registration.id);
    await queue.whenIdle();
  });

  it('keeps the invitation hidden until payment is verified', async () => {
    const { app } = createTestContext({ paymentsEnabled: true });
    const created = await register(app, {
      name: 'Katherine Johnson',
      phone: '+919876543210',
      consent: true,
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.registration.status, 'pending_payment');
    assert.equal(created.body.registration.inviteLink, null);
    const status = await request(app).get(`/api/registrations/${created.body.registration.id}`);
    assert.equal(status.body.registration.inviteLink, null);
  });
});
