import { createApp } from '../src/app.js';
import { createQueue } from '../src/automation/queue.js';
import { createMembershipHandler, markJobCrashed } from '../src/automation/membershipRunner.js';
import { createMemoryStore } from '../src/services/memoryStore.js';

export function testConfig(overrides = {}) {
  return {
    port: 0,
    nodeEnv: 'test',
    frontendOrigin: 'http://localhost:5173',
    adminUsername: 'admin',
    adminPassword: 'test-password-123',
    tokenSecret: 'test-token-secret-value',
    tokenTtlHours: 12,
    paymentsEnabled: false,
    razorpayKeyId: 'rzp_test_key',
    razorpayKeySecret: 'razorpay_secret_value',
    razorpayWebhookSecret: 'webhook_secret_value',
    paymentAmount: 49900,
    paymentCurrency: 'INR',
    database: 'file',
    mongoUri: '',
    dataDir: 'data',
    groupInviteLink: 'https://chat.whatsapp.com/InviteCode123',
    groupName: 'Members',
    admissionMode: 'invite',
    directAddEnabled: false,
    rateLimitEnabled: false,
    automationEnabled: false,
    ...overrides,
  };
}

export function createTestContext(overrides = {}, automation = null) {
  const config = testConfig(overrides);
  const store = createMemoryStore({
    inviteLink: config.groupInviteLink,
    admissionMode: config.admissionMode,
    groupName: config.groupName,
  });
  const queueRef = {};
  const queue = createQueue({
    handler: createMembershipHandler({ store, config, automation, queue: queueRef }),
    onError: (job) => markJobCrashed(store, job),
  });
  Object.assign(queueRef, queue);
  const orders = { n: 0 };
  const paymentClient = {
    async createOrder({ amount, currency, receipt }) {
      orders.n += 1;
      return { id: `order_test_${orders.n}`, amount, currency, receipt };
    },
    async fetchPayment(paymentId) {
      const orderNumber = paymentId.replace('pay_test_', '');
      return {
        id: paymentId,
        order_id: `order_test_${orderNumber}`,
        amount: config.paymentAmount,
        currency: config.paymentCurrency,
        status: 'captured',
      };
    },
  };
  const app = createApp({ store, queue, config, paymentClient, automation });
  return { app, store, queue, config, paymentClient };
}
