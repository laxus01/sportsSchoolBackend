import { Body, Controller, Post } from '@nestjs/common';
import { AdminLoginDto } from './dto/admin-login.dto';
import { AdminAuthService } from './admin-auth.service';

@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly adminAuthService: AdminAuthService) {}

  @Post('login')
  login(@Body() body: AdminLoginDto) {
    return this.adminAuthService.login(body.email, body.password);
  }
}
