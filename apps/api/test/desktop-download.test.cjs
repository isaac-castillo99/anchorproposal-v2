require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { Module } = require('@nestjs/common');
const { NestFactory, APP_GUARD } = require('@nestjs/core');
const { ConfigService } = require('@nestjs/config');
const { JwtAuthGuard } = require('../dist/auth/jwt-auth.guard');
const { DesktopController } = require('../dist/desktop/desktop.controller');
const { DesktopReleaseService } = require('../dist/desktop/desktop-release.service');
const { DesktopCatalogService } = require('../dist/desktop/desktop-catalog.service');
const { PrismaService } = require('../dist/prisma/prisma.service');
const { memoryDatabase } = require('./desktop-catalog-fixture.cjs');

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'anchor-download-'));
  const service = new DesktopReleaseService({ get: () => directory });
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const publish = async (content = Buffer.from('MZ-desktop-test-release'), kind = 'portable') => {
    const sha256 = createHash('sha256').update(content).digest('hex');
    const manifest = { version: '0.1.0', fileName: `AnchorProposal-${kind === 'setup' ? 'Setup-' : ''}0.1.0-${sha256.slice(0, 12)}.exe`, bytes: content.length, sha256, publishedAt: new Date().toISOString(), apiBaseUrl: 'https://api.example.test' };
    await fs.writeFile(path.join(directory, manifest.fileName), content);
    const previous = await fs.readFile(path.join(directory, 'release.json'), 'utf8').then(JSON.parse).catch(() => ({}));
    await fs.writeFile(path.join(directory, 'release.json'), JSON.stringify(kind === 'setup' ? { ...previous, setup: manifest } : { ...manifest, setup: previous.setup || null }));
    return { manifest, content };
  };
  return { directory, service, publish };
}

test('missing, malformed and incomplete desktop releases are unavailable', async t => {
  const f = await fixture(t);
  assert.equal(await f.service.current(), null);
  await fs.writeFile(path.join(f.directory, 'release.json'), '{');
  assert.equal(await f.service.current(), null);
  const { manifest } = await f.publish();
  await fs.writeFile(path.join(f.directory, manifest.fileName), 'partial');
  assert.equal(await f.service.current(), null);
});

test('release manifests cannot expose files outside the release directory', async t => {
  const f = await fixture(t); const { manifest } = await f.publish();
  for (const fileName of ['../private.env', 'C:\\private.exe', '/etc/passwd', 'AnchorProposal.exe']) {
    await fs.writeFile(path.join(f.directory, 'release.json'), JSON.stringify({ ...manifest, fileName }));
    assert.equal(await f.service.current(), null);
  }
});

test('new releases become available without restarting the API', async t => {
  const f = await fixture(t); const first = await f.publish();
  assert.equal((await f.service.current()).sha256, first.manifest.sha256);
  const second = await f.publish(Buffer.from('MZ-new-desktop-release'));
  assert.equal((await f.service.current()).sha256, second.manifest.sha256);
  assert.deepEqual(await fs.readFile(path.join(f.directory, first.manifest.fileName)), first.content);
});

test('setup and portable availability are independent and old manifests still work', async t => {
  const f = await fixture(t); const portable = await f.publish();
  assert.equal(await f.service.current('setup'), null);
  const setup = await f.publish(Buffer.from('MZ-setup-test'), 'setup');
  assert.equal((await f.service.current('setup')).sha256, setup.manifest.sha256);
  assert.equal((await f.service.current()).sha256, portable.manifest.sha256);
  await fs.unlink(path.join(f.directory, setup.manifest.fileName));
  assert.equal(await f.service.current('setup'), null);
  assert.equal((await f.service.current()).sha256, portable.manifest.sha256);
});

test('setup manifests cannot point at arbitrary files or mislabel the portable binary', async t => {
  const f = await fixture(t); const portable = await f.publish(); const setup = await f.publish(Buffer.from('MZ-setup'), 'setup');
  for (const fileName of ['../private.exe', 'C:\\private.exe', portable.manifest.fileName]) {
    await fs.writeFile(path.join(f.directory, 'release.json'), JSON.stringify({ ...portable.manifest, setup: { ...setup.manifest, fileName } }));
    assert.equal(await f.service.current('setup'), null);
    assert.ok(await f.service.current());
  }
});

test('public download streams attachments and supports HEAD and byte ranges without credentials', async t => {
  const f = await fixture(t);
  class DownloadTestModule {}
  Module({ controllers: [DesktopController], providers: [
    DesktopReleaseService, DesktopCatalogService, { provide: PrismaService, useValue: memoryDatabase() }, { provide: ConfigService, useValue: { get: () => f.directory } },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ] })(DownloadTestModule);
  const app = await NestFactory.create(DownloadTestModule, { logger: false });
  await app.listen(0, '127.0.0.1'); t.after(() => app.close());
  const base = await app.getUrl();
  assert.deepEqual(await (await fetch(`${base}/desktop/release`)).json(), { available: false });
  assert.equal((await fetch(`${base}/desktop/windows`)).status, 404);
  assert.equal((await fetch(`${base}/desktop/windows/setup`)).status, 404);
  const { manifest, content } = await f.publish();
  const metadataResponse = await fetch(`${base}/desktop/release`); const metadata = await metadataResponse.json();
  assert.equal(metadataResponse.status, 200); assert.equal(metadataResponse.headers.get('cache-control'), 'no-store');
  assert.equal(metadata.available, true); assert.equal(metadata.sha256, manifest.sha256);
  assert.equal(metadata.filePath, undefined); assert.equal(metadata.fileName, undefined);
  const response = await fetch(`${base}/desktop/windows`);
  assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'application/octet-stream');
  assert.match(response.headers.get('content-disposition'), /attachment; filename="AnchorProposal.exe"/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), content);
  const head = await fetch(`${base}/desktop/windows`, { method: 'HEAD' });
  assert.equal(Number(head.headers.get('content-length')), content.length); assert.equal((await head.text()).length, 0);
  const range = await fetch(`${base}/desktop/windows`, { headers: { Range: 'bytes=0-1' } });
  assert.equal(range.status, 206); assert.equal(range.headers.get('content-range'), `bytes 0-1/${content.length}`);
  assert.equal(await range.text(), 'MZ');
  const installer = await f.publish(Buffer.from('MZ-independent-setup-installer'), 'setup');
  const both = await (await fetch(`${base}/desktop/release`)).json();
  assert.equal(both.sha256, manifest.sha256);
  assert.equal(both.downloads.portable.sha256, manifest.sha256);
  assert.equal(both.downloads.setup.sha256, installer.manifest.sha256);
  assert.equal(both.downloads.setup.filePath, undefined); assert.equal(both.downloads.setup.fileName, undefined);
  const setup = await fetch(`${base}/desktop/windows/setup`);
  assert.equal(setup.status, 200); assert.match(setup.headers.get('content-disposition'), /attachment; filename="AnchorProposal-Setup.exe"/);
  assert.deepEqual(Buffer.from(await setup.arrayBuffer()), installer.content);
  const setupHead = await fetch(`${base}/desktop/windows/setup`, { method: 'HEAD' });
  assert.equal(Number(setupHead.headers.get('content-length')), installer.content.length);
  const setupRange = await fetch(`${base}/desktop/windows/setup`, { headers: { Range: 'bytes=0-1' } });
  assert.equal(setupRange.status, 206); assert.equal(await setupRange.text(), 'MZ');
});
