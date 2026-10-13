import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { requireAdmin } from './middleware/auth.js';
import { asyncHandler } from './middleware/asyncHandler.js';
import { errorHandler } from './middleware/errorHandler.js';
import { createPaymentService } from './services/paymentService.js';
import { createRegistrationService } from './services/registrationService.js';
import {
  createAdminController,
  createPaymentController,
  createRegistrationController,
} from './controllers/controllers.js';
import { adminRoutes } from './routes/admin.js';
import { paymentRoutes } from './routes/payments.js';
import { registrationRoutes } from './routes/registrations.js';

export function createApp({ store, queue, config, paymentClient = null, automation = null, staticDir = null }) {
  const registrations = createRegistrationService({ store, queue, config });
  const payments = createPaymentService({ store, queue, config, paymentClient });
  const registrationController = createRegistrationController(registrations);
  const paymentController = createPaymentController(payments);
  const admin = createAdminController({ registrations, store, config, automation, queue });
  const guard = requireAdmin(config);

  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: config.frontendOrigin }));

  app.post(
    '/api/payments/webhook',
    express.raw({ type: () => true, limit: '256kb' }),
    asyncHandler(paymentController.webhook),
  );
  app.use(express.json({ limit: '32kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/config', (_req, res) => {
    res.json({
      paymentsEnabled: config.paymentsEnabled,
      paymentAmount: config.paymentsEnabled ? config.paymentAmount : null,
      paymentCurrency: config.paymentsEnabled ? config.paymentCurrency : null,
      directAddEnabled: config.directAddEnabled,
    });
  });

  app.use('/api/registrations', registrationRoutes({ controller: registrationController, config }));
  app.use('/api/payments', paymentRoutes(paymentController));
  app.use('/api/admin', adminRoutes({ controller: admin, config, guard }));

  const indexFile = staticDir ? path.join(staticDir, 'index.html') : '';
  if (indexFile && fs.existsSync(indexFile)) {
    app.use(express.static(staticDir, { index: false, maxAge: '1h' }));
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
      res.sendFile(indexFile);
    });
  }

  app.use((req, res) => {
    res.status(404).json({ error: { code: 'not_found', message: `No route for ${req.method} ${req.path}` } });
  });
  app.use(errorHandler);
  return app;
}
