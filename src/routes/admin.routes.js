import { Router } from 'express';
import { asyncHandler } from '../middleware/async-handler.js';
import {
  authenticateAdmin,
  requireAdminRole,
  consumePasswordVerification,
  verifyPassword,
  issueAdminToken,
} from '../services/admin-auth.js';
import { HttpError } from '../utils/http-error.js';
import { asEmail } from '../utils/validation.js';

export function createAdminRouter({
  pool,
  config,
  adminService,
  loginLimiter,
}) {
  const router = Router();

  router.post(
    '/auth/login',
    loginLimiter,
    asyncHandler(async (req, res) => {
      const email = asEmail(req.body?.email);
      const password = req.body?.password;
      if (
        !email ||
        typeof password !== 'string' ||
        password.length < 1 ||
        password.length > 1024
      ) {
        throw new HttpError(401, 'ADMIN_CREDENTIALS_INVALID');
      }

      const result = await pool.query(
        `SELECT id, email, password_hash, role
         FROM admin_users
         WHERE email = $1 AND is_active = TRUE`,
        [email],
      );
      const admin = result.rows[0];
      if (!admin) {
        await consumePasswordVerification(password);
        throw new HttpError(401, 'ADMIN_CREDENTIALS_INVALID');
      }
      if (!(await verifyPassword(password, admin.password_hash))) {
        throw new HttpError(401, 'ADMIN_CREDENTIALS_INVALID');
      }

      res.json({
        accessToken: issueAdminToken(admin, config.adminJwtSecret),
        tokenType: 'Bearer',
        expiresIn: 1200,
        admin: { id: admin.id, email: admin.email, role: admin.role },
      });
    }),
  );

  router.use(authenticateAdmin(config.adminJwtSecret));

  router.get(
    '/schools',
    requireAdminRole('OWNER', 'ADMIN', 'SUPPORT'),
    asyncHandler(async (_req, res) => {
      res.json({ schools: await adminService.listSchools() });
    }),
  );

  router.post(
    '/schools',
    requireAdminRole('OWNER', 'ADMIN'),
    asyncHandler(async (req, res) => {
      const result = await adminService.createSchool(
        req.body ?? {},
        req.admin.sub,
      );
      res.status(201).json(result);
    }),
  );

  router.post(
    '/schools/:schoolId/activation-codes',
    requireAdminRole('OWNER', 'ADMIN'),
    asyncHandler(async (req, res) => {
      const result = await adminService.createActivationCode(
        req.params.schoolId,
        req.admin.sub,
      );
      res.status(201).json(result);
    }),
  );

  router.get(
    '/schools/:schoolId/installations',
    requireAdminRole('OWNER', 'ADMIN', 'SUPPORT'),
    asyncHandler(async (req, res) => {
      const installations = await adminService.listInstallations(
        req.params.schoolId,
      );
      res.json({ installations });
    }),
  );

  router.post(
    '/installations/:installationId/suspend',
    requireAdminRole('OWNER', 'ADMIN'),
    asyncHandler(async (req, res) => {
      res.json(
        await adminService.setInstallationStatus(
          req.params.installationId,
          'SUSPENDED',
          req.admin.sub,
        ),
      );
    }),
  );

  router.post(
    '/installations/:installationId/reactivate',
    requireAdminRole('OWNER', 'ADMIN'),
    asyncHandler(async (req, res) => {
      res.json(
        await adminService.setInstallationStatus(
          req.params.installationId,
          'ACTIVE',
          req.admin.sub,
        ),
      );
    }),
  );

  router.post(
    '/installations/:installationId/revoke',
    requireAdminRole('OWNER', 'ADMIN'),
    asyncHandler(async (req, res) => {
      res.json(
        await adminService.setInstallationStatus(
          req.params.installationId,
          'REVOKED',
          req.admin.sub,
        ),
      );
    }),
  );

  router.post(
    '/licenses/:licenseId/suspend',
    requireAdminRole('OWNER', 'ADMIN'),
    asyncHandler(async (req, res) => {
      res.json(
        await adminService.setLicenseStatus(
          req.params.licenseId,
          'SUSPENDED',
          req.admin.sub,
        ),
      );
    }),
  );

  router.post(
    '/licenses/:licenseId/reactivate',
    requireAdminRole('OWNER', 'ADMIN'),
    asyncHandler(async (req, res) => {
      res.json(
        await adminService.setLicenseStatus(
          req.params.licenseId,
          'ACTIVE',
          req.admin.sub,
        ),
      );
    }),
  );

  router.post(
    '/licenses/:licenseId/cancel',
    requireAdminRole('OWNER'),
    asyncHandler(async (req, res) => {
      res.json(
        await adminService.setLicenseStatus(
          req.params.licenseId,
          'CANCELLED',
          req.admin.sub,
        ),
      );
    }),
  );

  router.post(
    '/licenses/:licenseId/payments',
    requireAdminRole('OWNER', 'ADMIN'),
    asyncHandler(async (req, res) => {
      const idempotencyKey = req.get('idempotency-key');
      const result = await adminService.recordPayment(
        req.params.licenseId,
        req.body ?? {},
        idempotencyKey,
        req.admin.sub,
      );
      res.status(result.replayed ? 200 : 201).json(result);
    }),
  );

  router.get(
    '/licenses/:licenseId/events',
    requireAdminRole('OWNER', 'ADMIN', 'SUPPORT'),
    asyncHandler(async (req, res) => {
      const events = await adminService.listEvents(req.params.licenseId);
      res.json({ events });
    }),
  );

  return router;
}
