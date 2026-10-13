import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import request from 'supertest';
import { createTestContext } from './helpers.js';

describe('status transitions', () => {
  it('retries a browser failure and can be confirmed only with an explicit attestation', async () => {
    const automation = {
      calls: 0,
      async checkSession() {
        this.calls += 1;
        if (this.calls < 3) throw new Error('browser closed');
        return { state: 'authenticated' };
      },
      async tryAddParticipant() {
        return { outcome: 'not_selectable', reason: 'number_not_recognized' };
      },
    };
    const { app, queue, store } = createTestContext({ directAddEnabled: true }, automation);
    const created = await request(app).post('/api/registrations').send({
      name: 'Barbara Liskov',
      phone: '+14155550100',
      consent: true,
    });
    await queue.whenIdle();
    const failed = await store.getRegistration(created.body.registration.id);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.retryable, true);
    assert.equal(failed.failureCode, 'browser_crash');

    const token = (await request(app).post('/api/admin/login').send({
      username: 'admin',
      password: 'test-password-123',
    })).body.token;

    const premature = await request(app)
      .post(`/api/admin/registrations/${failed.id}/confirm`)
      .set('Authorization', `Bearer ${token}`)
      .send({ confirmedInGroup: true });
    assert.equal(premature.status, 400);

    const retried = await request(app)
      .post(`/api/admin/registrations/${failed.id}/retry`)
      .set('Authorization', `Bearer ${token}`);
    assert.equal(retried.status, 200);
    await queue.whenIdle();
    const ready = await store.getRegistration(failed.id);
    assert.equal(ready.status, 'invite_ready');
    assert.equal(ready.action, 'direct_add_unavailable');

    const blocked = await request(app)
      .post(`/api/admin/registrations/${failed.id}/retry`)
      .set('Authorization', `Bearer ${token}`);
    assert.equal(blocked.status, 400);

    const unattested = await request(app)
      .post(`/api/admin/registrations/${failed.id}/confirm`)
      .set('Authorization', `Bearer ${token}`)
      .send({ confirmedInGroup: false });
    assert.equal(unattested.status, 400);

    const confirmed = await request(app)
      .post(`/api/admin/registrations/${failed.id}/confirm`)
      .set('Authorization', `Bearer ${token}`)
      .send({ confirmedInGroup: true });
    assert.equal(confirmed.status, 200);
    assert.equal(confirmed.body.registration.status, 'joined_confirmed');
    assert.equal(confirmed.body.registration.confirmationSource, 'admin_attestation');
  });
});
