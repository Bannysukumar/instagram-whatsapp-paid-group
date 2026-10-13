import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';

export function paymentRoutes(controller) {
  const router = Router();
  router.post('/create-order', asyncHandler(controller.createOrder));
  router.post('/verify', asyncHandler(controller.verify));
  return router;
}
