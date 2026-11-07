import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { loadAppConfig } from './config/app-config';
import { createMysqlOptions } from './database/typeorm-options';
import { AdminModule } from './licensing/admin/admin.module';
import { DeviceModule } from './licensing/device/device.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      useFactory: () => createMysqlOptions(loadAppConfig()),
    }),
    HealthModule,
    DeviceModule,
    AdminModule,
  ],
})
export class AppModule {}
