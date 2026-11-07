import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { DeviceService } from './device.service';
import { DeviceChallengeDto } from './dto/device-challenge.dto';
import { ActivateInstallationDto } from './dto/activate-installation.dto';
import { RefreshLicenseDto } from './dto/refresh-license.dto';
import { DeactivateInstallationDto } from './dto/deactivate-installation.dto';

@Controller()
export class DeviceController {
  constructor(private readonly deviceService: DeviceService) {}

  @Post('device-challenges')
  async createChallenge(@Body() body: DeviceChallengeDto) {
    return this.deviceService.createChallenge(body);
  }

  @Post('installations/activate')
  async activate(@Body() body: ActivateInstallationDto) {
    return this.deviceService.activate(body);
  }

  @Post('licenses/refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() body: RefreshLicenseDto) {
    return this.deviceService.refresh(body);
  }

  @Post('installations/:installationId/deactivate')
  @HttpCode(HttpStatus.OK)
  async deactivate(
    @Param('installationId') installationId: string,
    @Body() body: DeactivateInstallationDto,
  ) {
    return this.deviceService.deactivate(installationId, body);
  }
}
