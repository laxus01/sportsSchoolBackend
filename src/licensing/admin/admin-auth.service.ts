import { Injectable, UnauthorizedException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { loadAppConfig } from '../../config/app-config';
import {
  consumePasswordVerification,
  issueAdminToken,
  verifyPassword,
} from '../../common/admin-auth';

interface AdminRow {
  id: string;
  email: string;
  password_hash: string;
  adminRole: 'OWNER' | 'ADMIN' | 'SUPPORT';
}

@Injectable()
export class AdminAuthService {
  private readonly config = loadAppConfig();

  constructor(private readonly dataSource: DataSource) {}

  async login(emailInput: string, password: string) {
    const email = emailInput.trim().toLowerCase();
    const rows = (await this.dataSource.query(
      `SELECT id, email, password_hash, admin_role AS adminRole
       FROM admin_users
       WHERE email = ? AND is_active = TRUE`,
      [email],
    )) as AdminRow[];
    const admin = rows[0];
    if (!admin) {
      await consumePasswordVerification(password);
      throw new UnauthorizedException('ADMIN_CREDENTIALS_INVALID');
    }
    if (!(await verifyPassword(password, admin.password_hash))) {
      throw new UnauthorizedException('ADMIN_CREDENTIALS_INVALID');
    }

    return {
      accessToken: issueAdminToken(
        { id: admin.id, role: admin.adminRole },
        this.config.adminJwtSecret,
      ),
      tokenType: 'Bearer',
      expiresIn: 1200,
      admin: { id: admin.id, email: admin.email, role: admin.adminRole },
    };
  }
}
