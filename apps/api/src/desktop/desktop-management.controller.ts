import { Body, Controller, Delete, Get, Header, Param, Patch, Post, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserRole } from '@prisma/client';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { AuthUser } from '../common/types/auth.types';
import { DesktopCatalogService } from './desktop-catalog.service';

// Separate from the public controller: JWT authentication runs before role checks and file parsing.
@Controller('desktop/manage/releases')
@UseGuards(RolesGuard)
@Roles(UserRole.MASTER)
export class DesktopManagementController {
  constructor(private readonly releases: DesktopCatalogService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(@Req() req: { user: AuthUser }) { return this.releases.list(req.user); }

  @Post()
  create(@Req() req: { user: AuthUser }, @Body() body: { version?: unknown; notes?: unknown }) {
    return this.releases.create(req.user, body);
  }

  @Patch(':id')
  update(@Req() req: { user: AuthUser }, @Param('id') id: string, @Body() body: { notes?: unknown; action?: unknown }) {
    return this.releases.update(req.user, id, body);
  }

  @Post(':id/files/:kind')
  @UseInterceptors(FileInterceptor('file'))
  upload(@Req() req: { user: AuthUser }, @Param('id') id: string, @Param('kind') kind: string,
    @UploadedFile() file?: { path: string; originalname: string; size: number }) {
    return this.releases.upload(req.user, id, kind, file);
  }

  @Delete(':id/files/:kind')
  removeFile(@Req() req: { user: AuthUser }, @Param('id') id: string, @Param('kind') kind: string) {
    return this.releases.removeFile(req.user, id, kind);
  }

  @Delete(':id')
  remove(@Req() req: { user: AuthUser }, @Param('id') id: string) { return this.releases.remove(req.user, id); }
}
