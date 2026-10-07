// Real PostgreSQL persistence and advisory-lock check. All database writes roll back.
require('reflect-metadata');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { ConfigModule } = require('@nestjs/config');
const { PrismaClient } = require('@prisma/client');
const { DesktopReleaseService } = require('../dist/desktop/desktop-release.service');
const { DesktopCatalogService } = require('../dist/desktop/desktop-catalog.service');
const { windowsExe } = require('./desktop-catalog-fixture.cjs');
(async () => {
  await ConfigModule.forRoot(); const prisma = new PrismaClient();
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'anchor-desktop-db-'));
  try {
    await prisma.$transaction(async tx => {
      const master = await tx.user.findFirst({ where: { role: 'MASTER' }, select: { id: true, role: true } }); assert.ok(master);
      const database = { systemSetting: tx.systemSetting, $transaction: operation => operation(tx) };
      const service = new DesktopCatalogService(new DesktopReleaseService({ get: () => directory }), database);
      const version = `0.0.0-qa.${randomUUID()}`;
      const release = await service.create(master, { version, notes: 'Rollback-only release QA' });
      const source = path.join(directory, 'incoming'); const bytes = windowsExe(); await fs.writeFile(source, bytes);
      await service.upload(master, release.id, 'setup', { path: source, size: bytes.length, originalname: 'setup.exe' });
      await service.update(master, release.id, { action: 'publish' });
      const reopened = new DesktopCatalogService(new DesktopReleaseService({ get: () => directory }), database);
      assert.equal((await reopened.list()).latestId, release.id);
      assert.deepEqual(await fs.readFile((await reopened.download(release.id, 'setup')).filePath), bytes);
      assert.equal(await tx.auditEvent.count({ where: { targetId: release.id, actorId: master.id } }), 3);
      await service.update(master, release.id, { action: 'unpublish' });
      await service.remove(master, release.id);
      assert.ok(!(await reopened.list()).releases.some(row => row.id === release.id));
      console.log('PASS: PostgreSQL catalog persistence, advisory lock, actor audit, reopened downloads and deletion; transaction rolls back.');
      throw new Error('QA_ROLLBACK');
    }, { timeout: 120000 }).catch(error => { if (error.message !== 'QA_ROLLBACK') throw error; });
  } finally {
    await prisma.$disconnect();
    if (path.dirname(directory) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith('anchor-desktop-db-')) throw new Error('Unsafe cleanup path');
    await fs.rm(directory, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
