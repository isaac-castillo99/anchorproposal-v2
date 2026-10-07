require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { Module } = require('@nestjs/common');
const { APP_GUARD, NestFactory } = require('@nestjs/core');
const { MulterModule } = require('@nestjs/platform-express');
const { JwtService } = require('@nestjs/jwt');
const { Strategy, ExtractJwt } = require('passport-jwt');
const passport = require('passport');
const { JwtAuthGuard } = require('../dist/auth/jwt-auth.guard');
const { DesktopReleaseService } = require('../dist/desktop/desktop-release.service');
const { DesktopCatalogService, DESKTOP_UPLOAD_LIMIT } = require('../dist/desktop/desktop-catalog.service');
const { DesktopController } = require('../dist/desktop/desktop.controller');
const { DesktopManagementController } = require('../dist/desktop/desktop-management.controller');
const { memoryDatabase, windowsExe } = require('./desktop-catalog-fixture.cjs');
const master = { id: 'master-test', role: 'MASTER' };

async function fixture(t, http = false) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'anchor-release-management-'));
  const uploadDir = path.join(directory, '.uploads'); await fs.mkdir(uploadDir);
  const database = memoryDatabase(); const legacy = new DesktopReleaseService({ get: () => directory });
  const service = new DesktopCatalogService(legacy, database);
  const uploadFile = async (content = windowsExe(), originalname = 'setup.exe') => {
    const target = path.join(uploadDir, `${Math.random()}.upload`); await fs.writeFile(target, content);
    return { path: target, size: content.length, originalname };
  };
  const result = { service, database, directory, uploadDir, uploadFile };
  t.after(() => {
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir())); assert.ok(path.basename(directory).startsWith('anchor-release-management-'));
    return fs.rm(directory, { recursive: true, force: true });
  });
  if (http) {
    const secret = 'test-only-desktop-release-secret'; const jwt = new JwtService({ secret });
    passport.use('jwt', new Strategy({ jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(), secretOrKey: secret }, (payload, done) => done(null, { id: 'master-test', role: payload.role })));
    class TestModule {}
    Module({ imports: [MulterModule.register({ dest: uploadDir, limits: { fileSize: 1024, files: 1, fields: 0, parts: 2 } })],
      controllers: [DesktopController, DesktopManagementController], providers: [
        { provide: DesktopCatalogService, useValue: service }, { provide: APP_GUARD, useClass: JwtAuthGuard },
      ] })(TestModule);
    const app = await NestFactory.create(TestModule, { logger: false }); await app.listen(0, '127.0.0.1');
    t.after(() => app.close()); const base = await app.getUrl();
    result.request = (route, { role = 'MASTER', method = 'GET', body, file } = {}) => {
      const headers = role ? { Authorization: `Bearer ${jwt.sign({ role })}` } : {};
      if (file) { body = new FormData(); body.append('file', new Blob([file.content]), file.name || 'installer.exe'); }
      else if (body !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(body); }
      return fetch(`${base}${route}`, { method, headers, body });
    };
  }
  return result;
}

test('signed-out, Admin and Bidder requests cannot read management or mutate releases, including multipart uploads', async t => {
  const f = await fixture(t, true);
  for (const role of [null, 'ADMIN', 'BIDDER']) {
    for (const [route, options] of [
      ['/desktop/manage/releases', {}],
      ['/desktop/manage/releases', { method: 'POST', body: { version: '1.0.0' } }],
      ['/desktop/manage/releases/unknown', { method: 'PATCH', body: { action: 'publish' } }],
      ['/desktop/manage/releases/unknown', { method: 'DELETE' }],
      ['/desktop/manage/releases/unknown/files/setup', { method: 'DELETE' }],
      ['/desktop/manage/releases/unknown/files/setup', { method: 'POST', file: { content: windowsExe() } }],
    ]) assert.equal((await f.request(route, { ...options, role })).status, role ? 403 : 401, `${role} ${route}`);
  }
  assert.deepEqual(await fs.readdir(f.uploadDir), []); assert.equal(f.database.audits.length, 0);
  assert.equal((await f.request('/desktop/release', { role: null })).status, 200);
});

test('Master upload validation rejects bad versions, non-executables, missing files, invalid kinds, oversize and duplicate files without residue', async t => {
  const f = await fixture(t, true);
  for (const version of ['', '../1.0.0', '1', '01.1.0', '<script>', '1.0.0/' ]) assert.equal((await f.request('/desktop/manage/releases', { method: 'POST', body: { version } })).status, 400);
  const created = await f.request('/desktop/manage/releases', { method: 'POST', body: { version: '1.0.0' } }); assert.equal(created.status, 201); const { id } = await created.json();
  assert.equal((await f.request('/desktop/manage/releases', { method: 'POST', body: { version: '1.0.0' } })).status, 409);
  const route = `/desktop/manage/releases/${id}/files/setup`;
  assert.equal((await f.request(route, { method: 'POST' })).status, 400);
  assert.equal((await f.request(route, { method: 'POST', file: { content: Buffer.from('not an executable') } })).status, 400);
  assert.equal((await f.request(route, { method: 'POST', file: { content: windowsExe(), name: 'installer.txt' } })).status, 400);
  assert.equal((await f.request(route, { method: 'POST', file: { content: Buffer.alloc(1025) } })).status, 413);
  assert.equal((await f.request(route.replace('/setup', '/invalid'), { method: 'POST', file: { content: windowsExe() } })).status, 400);
  assert.equal((await f.request(route, { method: 'POST', file: { content: windowsExe() } })).status, 201);
  assert.equal((await f.request(route, { method: 'POST', file: { content: windowsExe() } })).status, 409);
  assert.deepEqual(await fs.readdir(f.uploadDir), []);
  assert.equal((await fs.readdir(f.directory)).filter(file => file.endsWith('.exe')).length, 1);
  assert.equal(DESKTOP_UPLOAD_LIMIT, 512 * 1024 * 1024);
});

test('published history retains older downloads, latest selection, notes, HEAD and ranges; hiding and deleting revoke public access', async t => {
  const f = await fixture(t, true); const bytes = windowsExe('version one');
  const first = await f.service.create(master, { version: '1.0.0', notes: 'First release' });
  await f.service.upload(master, first.id, 'setup', await f.uploadFile(bytes));
  assert.equal((await f.service.list()).releases.length, 0);
  const url = `/desktop/releases/${first.id}/windows/setup`;
  assert.equal((await f.request(url, { role: null })).status, 404);
  await f.service.update(master, first.id, { action: 'publish' });
  const full = await f.request(url, { role: null }); assert.equal(full.status, 200);
  assert.match(full.headers.get('content-disposition'), /AnchorProposal-Setup-1.0.0.exe/);
  assert.deepEqual(Buffer.from(await full.arrayBuffer()), bytes);
  const metadata = await (await f.request('/desktop/release', { role: null })).json();
  assert.equal(metadata.latestId, first.id); assert.equal(metadata.releases[0].downloads.setup.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(metadata.releases[0].files, undefined); assert.equal(metadata.releases[0].uploaded, undefined);
  await assert.rejects(f.service.upload(master, first.id, 'portable', await f.uploadFile()), /Hide this release/);
  const second = await f.service.create(master, { version: '2.0.0' });
  await assert.rejects(f.service.update(master, second.id, { action: 'publish' }), /at least one/);
  await f.service.upload(master, second.id, 'portable', await f.uploadFile(windowsExe('version two')));
  await f.service.update(master, second.id, { action: 'publish' });
  assert.equal((await f.service.list()).releases.length, 2); assert.equal((await f.service.list()).latestId, second.id);
  assert.deepEqual(Buffer.from(await (await f.request(url, { role: null })).arrayBuffer()), bytes);
  assert.equal((await f.request(url, { role: null, method: 'HEAD' })).headers.get('content-length'), String(bytes.length));
  await f.service.update(master, first.id, { notes: 'Fixed release notes' });
  await f.service.update(master, first.id, { action: 'latest' }); assert.equal((await f.service.list()).latestId, first.id);
  await assert.rejects(f.service.remove(master, first.id), /Hide this release/);
  await f.service.update(master, first.id, { action: 'unpublish' }); assert.equal((await f.service.list()).latestId, second.id);
  assert.equal((await f.request(url, { role: null })).status, 404);
  assert.equal((await f.service.list(master)).releases.length, 2);
  await f.service.remove(master, first.id); assert.equal((await f.service.list(master)).releases.length, 1);
  const restored = new DesktopCatalogService(new DesktopReleaseService({ get: () => f.directory }), f.database);
  assert.equal((await restored.list()).latestId, second.id);
  assert.ok(f.database.audits.some(row => row.action === 'DESKTOP_RELEASE_DELETED' && row.actorId === master.id));
});

test('concurrent changes preserve versions and database failure cleans an uploaded executable', async t => {
  const f = await fixture(t);
  const results = await Promise.allSettled([f.service.create(master, { version: '1.0.0' }), f.service.create(master, { version: '1.0.0' }), f.service.create(master, { version: '2.0.0' })]);
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 2);
  assert.equal((await f.service.list(master)).releases.length, 2);
  const id = (await f.service.list(master)).releases[0].id;
  f.database.auditEvent.create = async () => { throw new Error('database unavailable'); };
  await assert.rejects(f.service.upload(master, id, 'setup', await f.uploadFile()), /database unavailable/);
  assert.equal((await f.service.list(master)).releases.find(row => row.id === id).downloads.setup, null);
  assert.deepEqual(await fs.readdir(f.uploadDir), []);
  assert.deepEqual((await fs.readdir(f.directory)).filter(name => name.endsWith('.exe')), []);
});

test('the existing release becomes manageable and cannot reappear after being hidden or deleted', async t => {
  const f = await fixture(t); const bytes = windowsExe(); const sha256 = createHash('sha256').update(bytes).digest('hex');
  const manifest = { version: '0.1.0', bytes: bytes.length, sha256, publishedAt: new Date().toISOString(), fileName: `AnchorProposal-0.1.0-${sha256.slice(0, 12)}.exe` };
  await fs.writeFile(path.join(f.directory, manifest.fileName), bytes); await fs.writeFile(path.join(f.directory, 'release.json'), JSON.stringify(manifest));
  assert.equal((await f.service.list()).releases[0].id, 'legacy-0.1.0');
  await f.service.update(master, 'legacy-0.1.0', { action: 'unpublish' }); assert.equal((await f.service.list()).releases.length, 0);
  await f.service.remove(master, 'legacy-0.1.0'); assert.equal((await f.service.list(master)).releases.length, 0);
  await fs.writeFile(path.join(f.directory, manifest.fileName), bytes);
  assert.equal((await f.service.list()).releases.length, 0);
});

test('service authorization rejects Admin and Bidder even outside HTTP and missing artifacts remain removable', async t => {
  const f = await fixture(t); const release = await f.service.create(master, { version: '1.0.0' });
  for (const role of ['ADMIN', 'BIDDER']) {
    const user = { ...master, role };
    for (const action of [() => f.service.list(user), () => f.service.create(user, { version: '2.0.0' }), () => f.service.update(user, release.id, { notes: 'No' }), () => f.service.remove(user, release.id), () => f.service.removeFile(user, release.id, 'setup')]) await assert.rejects(action(), /Only Master/);
  }
  await f.service.upload(master, release.id, 'setup', await f.uploadFile());
  const file = await f.service.download(release.id, 'setup', master); await fs.unlink(file.filePath);
  assert.equal((await f.service.list(master)).releases[0].uploaded.setup, true);
  assert.equal((await f.service.list(master)).releases[0].downloads.setup, null);
  await f.service.removeFile(master, release.id, 'setup');
  await f.service.upload(master, release.id, 'setup', await f.uploadFile());
  assert.ok((await f.service.list(master)).releases[0].downloads.setup);
});
