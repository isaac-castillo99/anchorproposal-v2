import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { createReadStream } from 'fs';
import { mkdir, open, rename, stat, unlink } from 'fs/promises';
import * as path from 'path';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/types/auth.types';
import { DesktopReleaseService } from './desktop-release.service';

export const DESKTOP_CATALOG_KEY = 'desktop_releases_v1';
export const DESKTOP_UPLOAD_LIMIT = 512 * 1024 * 1024;
export type DesktopKind = 'setup' | 'portable';
type Artifact = { fileName: string; bytes: number; sha256: string };
type Release = { id: string; version: string; notes: string; published: boolean; createdAt: string; publishedAt: string | null; files: Partial<Record<DesktopKind, Artifact>> };
type Catalog = { schemaVersion: 1; latestId: string | null; releases: Release[] };
type Upload = { path: string; originalname: string; size: number };
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

@Injectable()
export class DesktopCatalogService {
  constructor(private readonly legacy: DesktopReleaseService, private readonly prisma: PrismaService) {}

  private master(user: AuthUser) {
    if (user?.role !== UserRole.MASTER) throw new ForbiddenException('Only Master can manage desktop releases.');
  }
  private kind(value: string): DesktopKind {
    if (value !== 'setup' && value !== 'portable') throw new BadRequestException('Choose setup or portable.');
    return value;
  }
  private notes(value: unknown): string {
    if (typeof value !== 'string' || value.length > 10000) throw new BadRequestException('Release notes must be at most 10,000 characters.');
    return value.trim();
  }
  private async read(db: Pick<PrismaService, 'systemSetting'> = this.prisma): Promise<Catalog> {
    const saved = await db.systemSetting.findUnique({ where: { key: DESKTOP_CATALOG_KEY } });
    // Once managed through Settings, the database is authoritative, including an empty catalog.
    if (saved) {
      const value = JSON.parse(saved.value);
      if (value.schemaVersion !== 1 || !Array.isArray(value.releases)) throw new Error('Invalid desktop release catalog');
      return value;
    }
    const releases: Release[] = [];
    for (const kind of ['portable', 'setup'] as const) {
      const file = await this.legacy.current(kind);
      if (!file) continue;
      let release = releases.find(row => row.version === file.version);
      if (!release) {
        release = { id: `legacy-${file.version}`, version: file.version, notes: '', published: true, createdAt: file.publishedAt, publishedAt: file.publishedAt, files: {} };
        releases.push(release);
      }
      release.files[kind] = { fileName: file.fileName, bytes: file.bytes, sha256: file.sha256 };
    }
    return { schemaVersion: 1, latestId: releases[0]?.id || null, releases };
  }
  private async artifact(release: Release, kind: DesktopKind) {
    const file = release.files[kind];
    if (!file || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.bytes) || file.bytes <= 0) return null;
    const legacyName = `AnchorProposal-${kind === 'setup' ? 'Setup-' : ''}${release.version}-${file.sha256.slice(0, 12)}.exe`;
    if (file.fileName !== legacyName && !/^[a-f0-9-]{36}\.exe$/.test(file.fileName)) return null;
    if (path.basename(file.fileName) !== file.fileName) return null;
    const filePath = path.join(this.legacy.directory, file.fileName);
    const info = await stat(filePath).catch(() => null);
    if (!info?.isFile() || info.size !== file.bytes) return null;
    return { ...file, filePath, version: release.version, publishedAt: release.publishedAt || release.createdAt };
  }
  private async view(release: Release) {
    const downloads: Record<DesktopKind, object | null> = { setup: null, portable: null };
    for (const kind of ['setup', 'portable'] as const) {
      const file = await this.artifact(release, kind);
      if (file) downloads[kind] = { version: release.version, bytes: file.bytes, sha256: file.sha256, publishedAt: file.publishedAt,
        downloadPath: `/desktop/releases/${encodeURIComponent(release.id)}/windows/${kind}` };
    }
    return { id: release.id, version: release.version, notes: release.notes, published: release.published,
      createdAt: release.createdAt, publishedAt: release.publishedAt, downloads };
  }
  async list(user?: AuthUser) {
    if (user) this.master(user);
    const catalog = await this.read();
    const releases = await Promise.all(catalog.releases.filter(row => user || row.published)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(async row => ({ ...await this.view(row),
        ...(user ? { uploaded: { setup: Boolean(row.files.setup), portable: Boolean(row.files.portable) } } : {}) })));
    const downloadable = releases.filter(row => row.downloads.setup || row.downloads.portable);
    const latest = downloadable.find(row => row.id === catalog.latestId && row.published)
      || downloadable.find(row => row.published);
    return { latestId: latest?.id || null, releases };
  }
  async current(kind: DesktopKind = 'portable') {
    const catalog = await this.read();
    const ordered = catalog.releases.filter(row => row.published).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const preferred = ordered.find(row => row.id === catalog.latestId);
    if (preferred) { ordered.splice(ordered.indexOf(preferred), 1); ordered.unshift(preferred); }
    for (const release of ordered) {
      const file = await this.artifact(release, kind);
      if (file) return file;
    }
    return null;
  }
  async download(id: string, kindValue: string, user?: AuthUser) {
    if (user) this.master(user);
    const kind = this.kind(kindValue);
    const catalog = await this.read();
    const release = catalog.releases.find(row => row.id === id && (user || row.published));
    const file = release && await this.artifact(release, kind);
    if (!file) throw new NotFoundException('This desktop download is unavailable.');
    return file;
  }
  private async mutate<T>(user: AuthUser, action: string, id: string, change: (catalog: Catalog) => Promise<T> | T) {
    this.master(user);
    return this.prisma.$transaction(async tx => {
      // Serialize catalog writes across API workers; file hashing and upload happen outside this lock.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(71423, 9021)::text`;
      const catalog = await this.read(tx as Prisma.TransactionClient & Pick<PrismaService, 'systemSetting'>);
      const result = await change(catalog);
      const value = JSON.stringify(catalog);
      await tx.systemSetting.upsert({ where: { key: DESKTOP_CATALOG_KEY }, create: { key: DESKTOP_CATALOG_KEY, value }, update: { value } });
      await tx.auditEvent.create({ data: { actorId: user.id, action: `DESKTOP_RELEASE_${action}`, targetType: 'DesktopRelease', targetId: id } });
      return result;
    }, { maxWait: 10000, timeout: 30000 });
  }
  private find(catalog: Catalog, id: string) {
    const release = catalog.releases.find(row => row.id === id);
    if (!release) throw new NotFoundException('Desktop release not found.');
    return release;
  }
  async create(user: AuthUser, body: { version?: unknown; notes?: unknown }) {
    this.master(user);
    const version = typeof body?.version === 'string' ? body.version.trim() : '';
    if (version.length > 64 || !versionPattern.test(version)) throw new BadRequestException('Use a version such as 1.2.3 or 1.2.3-beta.1.');
    const notes = this.notes(body.notes ?? ''); const id = randomUUID();
    return this.mutate(user, 'CREATED', id, catalog => {
      if (catalog.releases.some(row => row.version === version)) throw new ConflictException('This version already exists.');
      const release: Release = { id, version, notes, published: false, createdAt: new Date().toISOString(), publishedAt: null, files: {} };
      catalog.releases.push(release); return { id };
    });
  }
  async update(user: AuthUser, id: string, body: { notes?: unknown; action?: unknown }) {
    this.master(user);
    const action = body?.action ?? 'notes';
    if (!['notes', 'publish', 'unpublish', 'latest'].includes(action as string)) throw new BadRequestException('Invalid release action.');
    const notes = action === 'notes' ? this.notes(body.notes) : undefined;
    return this.mutate(user, String(action).toUpperCase(), id, async catalog => {
      const release = this.find(catalog, id);
      if (action === 'notes') release.notes = notes!;
      if (action === 'publish' || action === 'latest') {
        if (action === 'latest' && !release.published) throw new BadRequestException('Publish the release before making it latest.');
        if (!await this.artifact(release, 'setup') && !await this.artifact(release, 'portable')) throw new BadRequestException('Upload at least one valid executable before publishing.');
        release.published = true; release.publishedAt ||= new Date().toISOString(); catalog.latestId = id;
      }
      if (action === 'unpublish') {
        release.published = false;
        if (catalog.latestId === id) catalog.latestId = null;
      }
      return { ok: true };
    });
  }
  async upload(user: AuthUser, id: string, kindValue: string, file?: Upload) {
    let staged: string | undefined;
    try {
      this.master(user); const kind = this.kind(kindValue);
      if (!file || !/\.exe$/i.test(file.originalname) || file.size > DESKTOP_UPLOAD_LIMIT || file.size < 64) throw new BadRequestException('Upload a Windows .exe file up to 512 MB.');
      const handle = await open(file.path, 'r');
      try {
        const header = Buffer.alloc(64); await handle.read(header, 0, 64, 0);
        const offset = header.readUInt32LE(60);
        if (header.toString('ascii', 0, 2) !== 'MZ' || offset < 64 || offset > Math.min(file.size - 6, 1048576)) throw new BadRequestException('The file is not a Windows executable.');
        const pe = Buffer.alloc(6); await handle.read(pe, 0, 6, offset);
        if (pe.toString('hex', 0, 4) !== '50450000' || ![0x14c, 0x8664].includes(pe.readUInt16LE(4))) throw new BadRequestException('The file is not a supported Windows executable.');
      } finally { await handle.close(); }
      const hash = createHash('sha256'); for await (const chunk of createReadStream(file.path)) hash.update(chunk);
      const artifact = { fileName: `${randomUUID()}.exe`, bytes: file.size, sha256: hash.digest('hex') };
      await mkdir(this.legacy.directory, { recursive: true }); staged = path.join(this.legacy.directory, artifact.fileName);
      await rename(file.path, staged);
      const result = await this.mutate(user, 'UPLOADED', id, catalog => {
        const release = this.find(catalog, id);
        if (release.published) throw new ConflictException('Hide this release before changing its files.');
        if (release.files[kind]) throw new ConflictException('Remove the existing file before uploading its replacement.');
        release.files[kind] = artifact; return { ok: true };
      });
      staged = undefined; return result;
    } finally {
      if (file) await unlink(file.path).catch(() => undefined);
      if (staged) await unlink(staged).catch(() => undefined);
    }
  }
  async removeFile(user: AuthUser, id: string, kindValue: string) {
    this.master(user); const kind = this.kind(kindValue);
    const file = await this.mutate(user, 'FILE_REMOVED', id, catalog => {
      const release = this.find(catalog, id);
      if (release.published) throw new ConflictException('Hide this release before changing its files.');
      const file = release.files[kind]; delete release.files[kind]; return file;
    });
    if (file) await this.clean(file); return { ok: true };
  }
  async remove(user: AuthUser, id: string) {
    const files = await this.mutate(user, 'DELETED', id, catalog => {
      const release = this.find(catalog, id);
      if (release.published) throw new ConflictException('Hide this release before deleting it.');
      catalog.releases = catalog.releases.filter(row => row.id !== id);
      if (catalog.latestId === id) catalog.latestId = null;
      return Object.values(release.files);
    });
    await Promise.all(files.map(file => this.clean(file))); return { ok: true };
  }
  private async clean(file: Artifact) {
    // Downloads already in progress may keep the file open on Windows. Catalog removal is authoritative.
    if (path.basename(file.fileName) === file.fileName) await unlink(path.join(this.legacy.directory, file.fileName)).catch(() => undefined);
  }
}
