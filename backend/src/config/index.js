import path from 'node:path';

export function loadConfig(env = process.env) {
  return {
    port: Number(env.PORT || 4000),
    nodeEnv: env.NODE_ENV || 'development',
    frontendOrigin: env.FRONTEND_ORIGIN || 'http://localhost:5173',
    adminUsername: (env.ADMIN_USERNAME || 'admin').trim(),
    adminPassword: env.ADMIN_PASSWORD || '',
    tokenSecret: env.TOKEN_SECRET || '',
    tokenTtlHours: Number(env.TOKEN_TTL_HOURS || 12),
    paymentsEnabled: env.PAYMENTS_ENABLED === 'true',
    razorpayKeyId: env.RAZORPAY_KEY_ID || '',
    razorpayKeySecret: env.RAZORPAY_KEY_SECRET || '',
    razorpayWebhookSecret: env.RAZORPAY_WEBHOOK_SECRET || '',
    paymentAmount: Number(env.PAYMENT_AMOUNT || 49900),
    paymentCurrency: (env.PAYMENT_CURRENCY || 'INR').toUpperCase(),
    database: env.DATABASE === 'mongo' ? 'mongo' : 'file',
    mongoUri: env.MONGODB_URI || '',
    dataDir: env.DATA_DIR || path.resolve(process.cwd(), 'data'),
    groupInviteLink: (env.GROUP_INVITE_LINK || '').trim(),
    groupName: (env.GROUP_NAME || '').trim(),
    admissionMode: env.ADMISSION_MODE === 'approval' ? 'approval' : 'invite',
    directAddEnabled: env.DIRECT_ADD_ENABLED === 'true',
    rateLimitEnabled: env.RATE_LIMIT_ENABLED !== 'false',
    automationEnabled: env.AUTOMATION_ENABLED !== 'false',
    trustProxy: env.TRUST_PROXY === 'true' || env.NODE_ENV === 'production',
    whatsappHeadless: env.WHATSAPP_HEADLESS === 'true',
  };
}

export function assertConfig(config) {
  const errors = [];
  if (!config.adminPassword || config.adminPassword.length < 8) {
    errors.push('ADMIN_PASSWORD must be at least 8 characters.');
  }
  if (!config.tokenSecret || config.tokenSecret.length < 16) {
    errors.push('TOKEN_SECRET must be at least 16 characters.');
  }
  if (!Number.isFinite(config.port) || config.port <= 0) {
    errors.push('PORT must be a positive number.');
  }
  if (config.paymentsEnabled) {
    if (!config.razorpayKeyId || !config.razorpayKeySecret || !config.razorpayWebhookSecret) {
      errors.push('Razorpay key id, key secret, and webhook secret are required when payments are enabled.');
    }
    if (!Number.isInteger(config.paymentAmount) || config.paymentAmount < 100) {
      errors.push('PAYMENT_AMOUNT must be an integer number of minor currency units, at least 100.');
    }
    if (!/^[A-Z]{3}$/.test(config.paymentCurrency)) {
      errors.push('PAYMENT_CURRENCY must be a 3-letter ISO currency code.');
    }
  }
  if (config.database === 'mongo' && !config.mongoUri) {
    errors.push('MONGODB_URI is required when DATABASE=mongo.');
  }
  if (config.groupInviteLink && !isValidInviteLink(config.groupInviteLink)) {
    errors.push('GROUP_INVITE_LINK must be an https://chat.whatsapp.com/ link.');
  }
  if (errors.length) {
    const error = new Error(errors.join(' '));
    error.code = 'invalid_config';
    throw error;
  }
}

export function isValidInviteLink(value) {
  try {
    const url = new URL(String(value || '').trim());
    return url.protocol === 'https:'
      && url.hostname === 'chat.whatsapp.com'
      && url.pathname.length > 1;
  } catch {
    return false;
  }
}
