import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { passwordsMatch, signToken } from '../middleware/auth.js';
import { HttpError } from '../httpError.js';

export function adminRoutes({ controller, config, guard }) {
  const router = Router();
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 8,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { code: 'rate_limited', message: 'Too many sign-in attempts. Try again later.' } },
    skip: () => !config.rateLimitEnabled,
  });

  router.post('/login', loginLimiter, asyncHandler(async (req, res) => {
    const username = String(req.body?.username || '');
    const password = String(req.body?.password || '');
    if (!passwordsMatch(username, config.adminUsername) || !passwordsMatch(password, config.adminPassword)) {
      throw new HttpError(401, 'invalid_credentials', 'The username or password is incorrect.');
    }
    res.json({
      token: signToken({
        username: config.adminUsername,
        secret: config.tokenSecret,
        ttlHours: config.tokenTtlHours,
      }),
      expiresInHours: config.tokenTtlHours,
    });
  }));

  router.get('/registrations', guard, asyncHandler(controller.list));
  router.get('/registrations/:id', guard, asyncHandler(controller.getOne));
  router.post('/registrations/:id/retry', guard, asyncHandler(controller.retry));
  router.post('/registrations/:id/review', guard, asyncHandler(controller.review));
  router.post('/registrations/:id/admit', guard, asyncHandler(controller.admit));
  router.post('/registrations/:id/confirm', guard, asyncHandler(controller.confirm));
  router.get('/settings', guard, asyncHandler(controller.getSettings));
  router.put('/settings', guard, asyncHandler(controller.updateSettings));
  router.get('/automation/status', guard, asyncHandler(controller.automationStatus));
  router.post('/automation/resume', guard, asyncHandler(controller.resumeQueue));
  router.post('/automation/session', guard, asyncHandler(controller.openSession));
  router.post('/automation/logout', guard, asyncHandler(controller.logoutWhatsApp));
  router.post('/automation/refresh', guard, asyncHandler(controller.refreshSession));
  router.get('/automation/screenshot', guard, asyncHandler(controller.screenshot));
  router.get('/automation/qr', guard, asyncHandler(controller.qr));
  router.get('/logs', guard, asyncHandler(controller.logs));
  return router;
}
