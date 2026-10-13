import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import request from 'supertest';
import { createTestContext } from './helpers.js';

async function login(app) {
  const response = await request(app).post('/api/admin/login').send({
    username: 'admin',
    password: 'test-password-123',
  });
  assert.equal(response.status, 200);
  return response.body.token;
}

describe('administrator access', () => {
  it('blocks the dashboard without a token and allows it with one', async () => {
    const { app, queue } = createTestContext();
    const denied = await request(app).get('/api/admin/registrations');
    assert.equal(denied.status, 401);
    const logs = await request(app).get('/api/admin/logs');
    assert.equal(logs.status, 401);
    const badLogin = await request(app).post('/api/admin/login').send({
      username: 'admin',
      password: 'wrong-password',
    });
    assert.equal(badLogin.status, 401);

    await request(app).post('/api/registrations').send({
      name: 'Radia Perlman',
      phone: '+14155550100',
      consent: true,
    });
    await queue.whenIdle();

    const token = await login(app);
    const list = await request(app)
      .get('/api/admin/registrations')
      .set('Authorization', `Bearer ${token}`)
      .query({ q: 'Radia' });
    assert.equal(list.status, 200);
    assert.equal(list.body.stats.total, 1);
    assert.equal(list.body.registrations[0].phoneE164, '+14155550100');

    const settings = await request(app)
      .put('/api/admin/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ inviteLink: 'https://evil.example/group', admissionMode: 'invite' });
    assert.equal(settings.status, 400);

    const updated = await request(app)
      .put('/api/admin/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({
        inviteLink: 'https://chat.whatsapp.com/NewCode456',
        admissionMode: 'approval',
        groupName: 'Members',
      });
    assert.equal(updated.status, 200);
    assert.match(updated.body.notice, /revoke/i);
  });
});
