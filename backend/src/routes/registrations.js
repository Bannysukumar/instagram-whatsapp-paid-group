import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { asyncHandler } from '../middleware/asyncHandler.js';

export function registrationRoutes({ controller, config }) {
  const router = Router();
  const registrationLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { code: 'rate_limited', message: 'Too many registrations from this network. Try again later.' } },
    skip: () => !config.rateLimitEnabled,
  });
  router.post('/', registrationLimiter, asyncHandler(controller.create));
  router.get('/:id', asyncHandler(controller.getOne));
  return router;
}
