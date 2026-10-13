import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import request from 'supertest';
import { paymentSignature, webhookSignature } from '../src/services/paymentService.js';
import { createTestContext } from './helpers.js';

describe('payments', () => {
  it('verifies a captured test payment once and then reveals the invite', async () => {
    const { app, queue, config } = createTestContext({ paymentsEnabled: true });
    const created = await request(app).post('/api/registrations').send({
      name: 'Mary Jackson',
      phone: '+14155550100',
      consent: true,
    });
    const registrationId = created.body.registration.id;
    const order = await request(app).post('/api/payments/create-order').send({ registrationId });
    assert.equal(order.status, 201);
    assert.equal(order.body.keyId, config.razorpayKeyId);
    assert.equal(order.body.amount, 49900);
    assert.equal(order.body.razorpayKeySecret, undefined);

    const reused = await request(app).post('/api/payments/create-order').send({ registrationId });
    assert.equal(reused.body.orderId, order.body.orderId);

    const bad = await request(app).post('/api/payments/verify').send({
      registrationId,
      razorpay_order_id: order.body.orderId,
      razorpay_payment_id: 'pay_test_1',
      razorpay_signature: 'deadbeef',
    });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error.code, 'invalid_signature');

    const signature = paymentSignature(order.body.orderId, 'pay_test_1', config.razorpayKeySecret);
    const verified = await request(app).post('/api/payments/verify').send({
      registrationId,
      razorpay_order_id: order.body.orderId,
      razorpay_payment_id: 'pay_test_1',
      razorpay_signature: signature,
    });
    assert.equal(verified.status, 200);
    assert.equal(verified.body.duplicate, false);

    const again = await request(app).post('/api/payments/verify').send({
      registrationId,
      razorpay_order_id: order.body.orderId,
      razorpay_payment_id: 'pay_test_1',
      razorpay_signature: signature,
    });
    assert.equal(again.body.duplicate, true);
    await queue.whenIdle();

    const status = await request(app).get(`/api/registrations/${registrationId}`);
    assert.equal(status.body.registration.status, 'invite_ready');
    assert.equal(status.body.registration.inviteLink, config.groupInviteLink);
    const adminDenied = await request(app).get('/api/admin/registrations');
    assert.equal(adminDenied.status, 401);
  });

  it('ignores a webhook whose amount does not match and accepts a valid one once', async () => {
    const { app, queue, config, store } = createTestContext({ paymentsEnabled: true });
    const created = await request(app).post('/api/registrations').send({
      name: 'Dorothy Vaughan',
      phone: '+447911123456',
      consent: true,
    });
    const registrationId = created.body.registration.id;
    const order = await request(app).post('/api/payments/create-order').send({ registrationId });

    const mismatch = {
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_bad_amount',
            order_id: order.body.orderId,
            amount: 100,
            currency: 'INR',
            status: 'captured',
          },
        },
      },
    };
    const mismatchRaw = Buffer.from(JSON.stringify(mismatch));
    const mismatchResponse = await request(app)
      .post('/api/payments/webhook')
      .set('Content-Type', 'application/octet-stream')
      .set('x-razorpay-signature', webhookSignature(mismatchRaw, config.razorpayWebhookSecret))
      .send(mismatchRaw);
    assert.equal(mismatchResponse.status, 200);
    assert.equal(mismatchResponse.body.ignored, true);
    assert.equal((await store.getRegistration(registrationId)).status, 'pending_payment');

    const unsigned = await request(app)
      .post('/api/payments/webhook')
      .set('Content-Type', 'application/octet-stream')
      .set('x-razorpay-signature', 'nope')
      .send(mismatchRaw);
    assert.equal(unsigned.status, 400);

    const captured = {
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_webhook_1',
            order_id: order.body.orderId,
            amount: 49900,
            currency: 'INR',
            status: 'captured',
          },
        },
      },
    };
    const raw = Buffer.from(JSON.stringify(captured));
    const signature = webhookSignature(raw, config.razorpayWebhookSecret);
    const first = await request(app)
      .post('/api/payments/webhook')
      .set('Content-Type', 'application/octet-stream')
      .set('x-razorpay-signature', signature)
      .send(raw);
    const second = await request(app)
      .post('/api/payments/webhook')
      .set('Content-Type', 'application/octet-stream')
      .set('x-razorpay-signature', signature)
      .send(raw);
    assert.equal(first.body.duplicate, false);
    assert.equal(second.body.duplicate, true);
    await queue.whenIdle();
    const saved = await store.getRegistration(registrationId);
    assert.equal(saved.paymentStatus, 'verified');
    assert.equal(saved.attempts, 1);
  });

  it('refuses order creation when payments are disabled', async () => {
    const { app } = createTestContext({ paymentsEnabled: false });
    const response = await request(app).post('/api/payments/create-order').send({ registrationId: 'reg_x' });
    assert.equal(response.status, 403);
    assert.equal(response.body.error.code, 'payments_disabled');
  });
});
