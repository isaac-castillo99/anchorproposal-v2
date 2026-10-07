import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile, stat } from 'fs/promises';
import * as path from 'path';

type Release = {
  version: string;
  fileName: string;
  bytes: number;
  sha256: string;
  publishedAt: string;
  apiBaseUrl: string;
};

@Injectable()
export class DesktopReleaseService {
  readonly directory: string;

  constructor(config: ConfigService) {
    this.directory = path.resolve(config.get<string>('DESKTOP_RELEASE_DIR') || path.join(__dirname, '../../storage/desktop'));
  }

  async current(kind: 'portable' | 'setup' = 'portable'): Promise<(Release & { filePath: string }) | null> {
    try {
      const manifest = JSON.parse(await readFile(path.join(this.directory, 'release.json'), 'utf8'));
      const release: Release = kind === 'setup' ? manifest.setup : manifest;
      if (!release) return null;
      if (!/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(release.version) ||
          !/^[a-f0-9]{64}$/.test(release.sha256) ||
          release.fileName !== `AnchorProposal-${kind === 'setup' ? 'Setup-' : ''}${release.version}-${release.sha256.slice(0, 12)}.exe` ||
          !Number.isSafeInteger(release.bytes) || release.bytes <= 0 ||
          !Number.isFinite(Date.parse(release.publishedAt))) return null;
      const filePath = path.join(this.directory, release.fileName);
      const file = await stat(filePath);
      if (!file.isFile() || file.size !== release.bytes) return null;
      return { version: release.version, fileName: release.fileName, bytes: release.bytes, sha256: release.sha256,
        publishedAt: release.publishedAt, apiBaseUrl: typeof release.apiBaseUrl === 'string' ? release.apiBaseUrl : '', filePath };
    } catch {
      // Missing or incomplete uploads must never produce an enabled, broken download link.
      return null;
    }
  }
}
