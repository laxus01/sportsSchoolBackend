import { Module } from '@nestjs/common';
import {
  AdminAuthGuard,
  RolesGuard,
} from '../../common/admin-auth';
import { AdminAuthController } from './admin-auth.controller';
import { AdminController } from './admin.controller';
import { AdminAuthService } from './admin-auth.service';
import { AdminService } from './admin.service';

@Module({
  controllers: [AdminAuthController, AdminController],
  providers: [
    AdminAuthService,
    AdminService,
    AdminAuthGuard,
    RolesGuard,
  ],
})
export class AdminModule {}
