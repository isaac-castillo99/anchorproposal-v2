import { Module } from '@nestjs/common';
import { DesktopController } from './desktop.controller';
import { DesktopReleaseService } from './desktop-release.service';
import { DesktopCatalogService, DESKTOP_UPLOAD_LIMIT } from './desktop-catalog.service';
import { DesktopManagementController } from './desktop-management.controller';
import { MulterModule } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';

@Module({
  imports: [MulterModule.registerAsync({ inject: [ConfigService], useFactory: (config: ConfigService) => ({
    dest: path.join(new DesktopReleaseService(config).directory, '.uploads'),
    limits: { fileSize: DESKTOP_UPLOAD_LIMIT, files: 1, fields: 0, parts: 2 },
  }) })],
  controllers: [DesktopController, DesktopManagementController], providers: [DesktopReleaseService, DesktopCatalogService],
})
export class DesktopModule {}
