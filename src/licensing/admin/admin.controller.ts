import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  AdminAuthGuard,
  AdminPrincipal,
  CurrentAdmin,
  Roles,
  RolesGuard,
} from '../../common/admin-auth';
import { AdminService } from './admin.service';
import { CreateSchoolDto } from './dto/create-school.dto';
import { RecordLicensePaymentDto } from './dto/record-license-payment.dto';

@Controller('admin')
@UseGuards(AdminAuthGuard, RolesGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('schools')
  @Roles('OWNER', 'ADMIN', 'SUPPORT')
  listSchools() {
    return this.adminService.listSchools();
  }

  @Post('schools')
  @Roles('OWNER', 'ADMIN')
  createSchool(
    @Body() body: CreateSchoolDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ) {
    return this.adminService.createSchool(body, admin.id);
  }

  @Post('schools/:schoolId/activation-codes')
  @Roles('OWNER', 'ADMIN')
  createActivationCode(
    @Param('schoolId') schoolId: string,
    @CurrentAdmin() admin: AdminPrincipal,
  ) {
    return this.adminService.createActivationCode(schoolId, admin.id);
  }

  @Get('schools/:schoolId/installations')
  @Roles('OWNER', 'ADMIN', 'SUPPORT')
  listInstallations(@Param('schoolId') schoolId: string) {
    return this.adminService.listInstallations(schoolId);
  }

  @Post('installations/:installationId/suspend')
  @Roles('OWNER', 'ADMIN')
  suspendInstallation(@Param('installationId') id: string, @CurrentAdmin() admin: AdminPrincipal) {
    return this.adminService.setInstallationStatus(id, 'SUSPENDED', admin.id);
  }

  @Post('installations/:installationId/reactivate')
  @Roles('OWNER', 'ADMIN')
  reactivateInstallation(@Param('installationId') id: string, @CurrentAdmin() admin: AdminPrincipal) {
    return this.adminService.setInstallationStatus(id, 'ACTIVE', admin.id);
  }

  @Post('installations/:installationId/revoke')
  @Roles('OWNER', 'ADMIN')
  revokeInstallation(@Param('installationId') id: string, @CurrentAdmin() admin: AdminPrincipal) {
    return this.adminService.setInstallationStatus(id, 'REVOKED', admin.id);
  }

  @Post('licenses/:licenseId/suspend')
  @Roles('OWNER', 'ADMIN')
  suspendLicense(@Param('licenseId') id: string, @CurrentAdmin() admin: AdminPrincipal) {
    return this.adminService.setLicenseStatus(id, 'SUSPENDED', admin.id);
  }

  @Post('licenses/:licenseId/reactivate')
  @Roles('OWNER', 'ADMIN')
  reactivateLicense(@Param('licenseId') id: string, @CurrentAdmin() admin: AdminPrincipal) {
    return this.adminService.setLicenseStatus(id, 'ACTIVE', admin.id);
  }

  @Post('licenses/:licenseId/cancel')
  @Roles('OWNER')
  cancelLicense(@Param('licenseId') id: string, @CurrentAdmin() admin: AdminPrincipal) {
    return this.adminService.setLicenseStatus(id, 'CANCELLED', admin.id);
  }

  @Post('licenses/:licenseId/payments')
  @Roles('OWNER', 'ADMIN')
  @HttpCode(HttpStatus.OK)
  recordPayment(
    @Param('licenseId') licenseId: string,
    @Body() body: RecordLicensePaymentDto,
    @Headers('idempotency-key') idempotencyKey: string,
    @CurrentAdmin() admin: AdminPrincipal,
  ) {
    return this.adminService.recordPayment(
      licenseId,
      body,
      idempotencyKey,
      admin.id,
    );
  }

  @Get('licenses/:licenseId/events')
  @Roles('OWNER', 'ADMIN', 'SUPPORT')
  listEvents(@Param('licenseId') licenseId: string) {
    return this.adminService.listEvents(licenseId);
  }
}
