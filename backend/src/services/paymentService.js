import crypto from 'node:crypto';
import { HttpError } from '../httpError.js';
import { buildPaymentRecord } from '../models/payment.js';
import { withKeyLock } from './locks.js';

export function paymentSignature(orderId, paymentId, secret) {
  return crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
}

export function webhookSignature(rawBody, secret) {
  return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

export function signaturesMatch(expectedHex, actualHex) {
  const actual = String(actualHex || '');
  const expected = String(expectedHex || '');
  if (!actual || actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

async function settlePayment({ store, queue, registrationId, orderId, paymentId, amount, currency, source }) {
  return withKeyLock(`pay:${registrationId}`, async () => {
    const current = await store.getRegistration(registrationId);
    if (!current) throw new HttpError(404, 'not_found', 'Registration not found.');
    if (current.payment?.orderId !== orderId) {
      throw new HttpError(400, 'order_mismatch', 'The payment does not match this registration.');
    }
    const expectedAmount = Number(current.payment.amount);
    const expectedCurrency = current.payment.currency;
    if (Number(amount) !== expectedAmount || currency !== expectedCurrency) {
      await store.addLog({
        level: 'error',
        event: 'payment_amount_mismatch',
        registrationId: current.id,
        detail: { source },
      });
      const error = new HttpError(400, 'amount_mismatch', 'The payment amount does not match the order.');
      error.ignoreWebhook = true;
      throw error;
    }
    if (current.paymentStatus === 'verified') {
      return { duplicate: true, registration: current };
    }
    const recorded = await store.recordPayment(buildPaymentRecord({
      paymentId,
      orderId,
      registrationId: current.id,
      amount: expectedAmount,
      currency,
      source,
    }));
    if (!recorded.created) {
      return { duplicate: true, registration: await store.getRegistration(current.id) };
    }
    const updated = await store.updateRegistration(current.id, {
      status: 'processing',
      paymentStatus: 'verified',
      payment: { ...current.payment, paymentId },
      failureCode: null,
      failureMessage: null,
      retryable: false,
    });
    queue.enqueue({ id: current.id, type: 'membership' });
    await store.addLog({
      level: 'info',
      event: 'payment_verified',
      registrationId: current.id,
      detail: { source, orderId },
    });
    return { duplicate: false, registration: updated };
  });
}

export function createPaymentService({ store, queue, config, paymentClient }) {
  return {
    async createOrder(registrationId) {
      if (!config.paymentsEnabled) {
        throw new HttpError(403, 'payments_disabled', 'Payments are turned off.');
      }
      if (!paymentClient) {
        throw new HttpError(503, 'payment_provider_unavailable', 'The payment provider is not configured.');
      }
      const registration = await store.getRegistration(registrationId);
      if (!registration) throw new HttpError(404, 'not_found', 'Registration not found.');
      if (registration.paymentStatus === 'verified') {
        throw new HttpError(409, 'already_paid', 'Payment is already verified for this registration.');
      }
      if (registration.payment?.orderId) {
        return {
          registrationId: registration.id,
          orderId: registration.payment.orderId,
          amount: registration.payment.amount,
          currency: registration.payment.currency,
          keyId: config.razorpayKeyId,
        };
      }
      let order;
      try {
        order = await paymentClient.createOrder({
          amount: config.paymentAmount,
          currency: config.paymentCurrency,
          receipt: registration.id,
        });
      } catch {
        throw new HttpError(502, 'payment_provider_unavailable', 'The payment provider could not create an order.');
      }
      await store.updateRegistration(registration.id, {
        payment: {
          orderId: order.id,
          paymentId: null,
          amount: config.paymentAmount,
          currency: config.paymentCurrency,
        },
      });
      await store.addLog({
        level: 'info',
        event: 'payment_order_created',
        registrationId: registration.id,
        detail: { orderId: order.id },
      });
      return {
        registrationId: registration.id,
        orderId: order.id,
        amount: config.paymentAmount,
        currency: config.paymentCurrency,
        keyId: config.razorpayKeyId,
      };
    },

    async verifyCheckout({ registrationId, orderId, paymentId, signature }) {
      if (!config.paymentsEnabled) {
        throw new HttpError(403, 'payments_disabled', 'Payments are turned off.');
      }
      const expected = paymentSignature(orderId, paymentId, config.razorpayKeySecret);
      if (!signaturesMatch(expected, signature)) {
        throw new HttpError(400, 'invalid_signature', 'Payment verification failed.');
      }
      if (!paymentClient?.fetchPayment) {
        throw new HttpError(503, 'payment_provider_unavailable', 'The payment provider is not configured.');
      }
      let payment;
      try {
        payment = await paymentClient.fetchPayment(paymentId);
      } catch {
        throw new HttpError(502, 'payment_provider_unavailable', 'The payment provider could not confirm this payment.');
      }
      if (payment.order_id !== orderId) {
        throw new HttpError(400, 'order_mismatch', 'The payment does not match this order.');
      }
      if (payment.status !== 'captured') {
        throw new HttpError(400, 'payment_not_captured', 'The payment is not captured yet.');
      }
      return settlePayment({
        store,
        queue,
        registrationId,
        orderId,
        paymentId,
        amount: Number(payment.amount),
        currency: payment.currency,
        source: 'checkout',
      });
    },

    async handleWebhook(rawBody, signatureHeader) {
      if (!config.paymentsEnabled) {
        throw new HttpError(403, 'payments_disabled', 'Payments are turned off.');
      }
      const expected = webhookSignature(rawBody, config.razorpayWebhookSecret);
      if (!signaturesMatch(expected, signatureHeader)) {
        throw new HttpError(400, 'invalid_signature', 'Webhook signature verification failed.');
      }
      let event;
      try {
        event = JSON.parse(rawBody.toString('utf8'));
      } catch {
        throw new HttpError(400, 'invalid_json', 'Webhook body must be JSON.');
      }
      if (event.event !== 'payment.captured') {
        return { received: true, ignored: true };
      }
      const entity = event.payload?.payment?.entity;
      if (!entity || entity.status !== 'captured') {
        return { received: true, ignored: true };
      }
      const registration = await store.getByOrderId(entity.order_id);
      if (!registration) {
        await store.addLog({
          level: 'error',
          event: 'payment_order_unknown',
          detail: { source: 'webhook' },
        });
        return { received: true, ignored: true };
      }
      try {
        const result = await settlePayment({
          store,
          queue,
          registrationId: registration.id,
          orderId: entity.order_id,
          paymentId: entity.id,
          amount: Number(entity.amount),
          currency: entity.currency,
          source: 'webhook',
        });
        return { received: true, duplicate: result.duplicate };
      } catch (error) {
        if (error.ignoreWebhook) return { received: true, ignored: true };
        throw error;
      }
    },
  };
}

export async function createRazorpayClient(config) {
  const imported = await import('razorpay');
  const Razorpay = imported.default?.default || imported.default || imported;
  const client = new Razorpay({
    key_id: config.razorpayKeyId,
    key_secret: config.razorpayKeySecret,
  });
  return {
    async createOrder({ amount, currency, receipt }) {
      const order = await client.orders.create({
        amount,
        currency,
        receipt,
        payment_capture: 1,
      });
      return {
        id: order.id,
        amount: Number(order.amount),
        currency: order.currency,
        receipt: order.receipt,
      };
    },
    async fetchPayment(paymentId) {
      const payment = await client.payments.fetch(paymentId);
      return {
        id: payment.id,
        order_id: payment.order_id,
        amount: Number(payment.amount),
        currency: payment.currency,
        status: payment.status,
      };
    },
  };
}
