import { Controller, Get, Header, NotFoundException, Param, Res } from '@nestjs/common';
import { Response } from 'express';
import { Public } from '../common/decorators/roles.decorator';
import { DesktopCatalogService, DesktopKind } from './desktop-catalog.service';

@Public()
@Controller('desktop')
export class DesktopController {
  constructor(private readonly releases: DesktopCatalogService) {}

  @Get('release')
  @Header('Cache-Control', 'no-store')
  async release() {
    const catalog = await this.releases.list();
    const latest = catalog.releases.find(row => row.id === catalog.latestId);
    if (!latest) return catalog.releases.length ? { available: false, ...catalog } : { available: false };
    return { available: true, platform: 'Windows', architecture: 'x64',
      ...(latest.downloads.portable || latest.downloads.setup), downloads: latest.downloads, ...catalog };
  }

  @Get('releases/:id/windows/:kind')
  async version(@Param('id') id: string, @Param('kind') kind: string, @Res() response: Response) {
    const file = await this.releases.download(id, kind);
    return this.sendFile(response, file, kind as DesktopKind, true);
  }

  @Get('windows')
  async download(@Res() response: Response) {
    return this.sendDownload(response, 'portable');
  }

  @Get('windows/setup')
  async setup(@Res() response: Response) {
    return this.sendDownload(response, 'setup');
  }

  private async sendDownload(response: Response, kind: 'portable' | 'setup') {
    const release = await this.releases.current(kind);
    if (!release) throw new NotFoundException('The Windows download is not available yet.');
    return this.sendFile(response, release, kind);
  }

  private sendFile(response: Response, release: { filePath: string; version: string }, kind: DesktopKind, versioned = false) {
    // Express streams the file and supports HEAD, Range and conditional requests.
    // Never load the executable into memory or accept a filesystem path from a visitor.
    response.download(release.filePath, `AnchorProposal${kind === 'setup' ? '-Setup' : ''}${versioned ? `-${release.version}` : ''}.exe`, {
      headers: { 'Content-Type': 'application/octet-stream', 'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'public, max-age=0, must-revalidate' },
    });
  }
}
