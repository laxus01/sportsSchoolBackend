import { Router } from 'express';
import { asyncHandler } from '../middleware/async-handler.js';

export function createDeviceRouter(
  deviceService,
  challengeLimiter,
  deviceActionLimiter,
) {
  const router = Router();

  router.post(
    '/device-challenges',
    challengeLimiter,
    asyncHandler(async (req, res) => {
      const challenge = await deviceService.createChallenge(req.body ?? {});
      res.status(201).json(challenge);
    }),
  );

  router.post(
    '/installations/activate',
    deviceActionLimiter,
    asyncHandler(async (req, res) => {
      const result = await deviceService.activate(req.body ?? {});
      res.status(201).json(result);
    }),
  );

  router.post(
    '/licenses/refresh',
    deviceActionLimiter,
    asyncHandler(async (req, res) => {
      const result = await deviceService.refresh(req.body ?? {});
      res.status(200).json(result);
    }),
  );

  router.post(
    '/installations/:installationId/deactivate',
    deviceActionLimiter,
    asyncHandler(async (req, res) => {
      const result = await deviceService.deactivate({
        ...(req.body ?? {}),
        installationId: req.params.installationId,
      });
      res.status(200).json(result);
    }),
  );

  return router;
}
