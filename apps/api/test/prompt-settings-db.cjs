// Verify tenant isolation using temporary records inside a transaction that always rolls back.
require('reflect-metadata');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { ConfigModule } = require('@nestjs/config');
const { PrismaClient } = require('@prisma/client');
const { SettingsService } = require('../dist/settings/settings.service');

(async () => {
  await ConfigModule.forRoot();
  const prisma = new PrismaClient();
  const marker = randomUUID();
  const rollback = new Error('Intentional prompt-settings rollback');
  const ids = [];
  try {
    try {
      await prisma.$transaction(async (tx) => {
        const database = new Proxy(tx, { get: (target, key) => key === '$transaction' ? (fn) => fn(tx) : target[key] });
        const service = new SettingsService(database);
        const admin = async (label) => {
          const row = await tx.user.create({ data: { email: `${marker}-${label}@qa.invalid`, passwordHash: 'not-a-login-hash', firstName: label, lastName: 'QA', role: 'ADMIN' } });
          ids.push(row.id); return row;
        };
        const a = await admin('AdminA');
        const b = await admin('AdminB');
        const shared = await tx.promptVersion.create({ data: { name: 'QA shared default', content: 'Shared default content', isPublished: true, isInitial: true, publishedAt: new Date('2100-01-01') } });
        const profile = await tx.profile.create({ data: { firstName: 'QA', lastName: 'Profile', promptVersionId: shared.id } });

        let saved = await service.updateMyPromptSettings(a, { mode: 'user', content: 'Admin A private default' });
        const firstPrivateId = saved.effectivePrompt.id;
        assert.equal(saved.effectivePrompt.content, 'Admin A private default');
        assert.equal(saved.assignmentMode, 'user');
        assert.equal((await service.getMyPromptSettings(b)).effectivePrompt.id, shared.id);
        assert.equal((await service.getMyPromptSettings(b)).assignmentMode, 'profile');
        assert.equal((await tx.promptVersion.findUnique({ where: { id: shared.id } })).content, 'Shared default content');
        assert.equal((await tx.promptVersion.findUnique({ where: { id: firstPrivateId } })).isPersonalDefault, true);

        const one = await service.resolveGenerationPrompt(a, profile.id);
        assert.equal(one.prompt.id, firstPrivateId, 'single prompt mode must ignore the assigned profile prompt');
        assert.equal(one.usedDefault, false, 'intentional single-prompt use must not show a missing-assignment warning');
        await service.updateMyPromptSettings(a, { mode: 'profile' });
        assert.equal((await service.resolveGenerationPrompt(a, profile.id)).prompt.id, shared.id);
        await tx.profile.update({ where: { id: profile.id }, data: { promptVersionId: null } });
        const fallback = await service.resolveGenerationPrompt(a, profile.id);
        assert.equal(fallback.prompt.id, firstPrivateId);
        assert.equal(fallback.usedDefault, true);

        for (const actor of [a, b, { id: 'qa-master', role: 'MASTER' }]) {
          assert.ok(!(await service.listAssignablePrompts(actor)).some((p) => p.id === firstPrivateId));
          await assert.rejects(service.assertAssignablePrompts(actor, [firstPrivateId]));
        }
        assert.ok(!(await service.listManagedPrompts(a)).some((p) => p.id === firstPrivateId));
        await service.updateMyPromptSettings(b, { mode: 'user', content: 'Admin B private default' });
        await service.updateMyPromptSettings(a, { content: 'Admin A revised default' });
        assert.equal((await tx.promptVersion.findUnique({ where: { id: firstPrivateId } })).content, 'Admin A private default', 'saved prompt versions must stay intact');
        assert.equal((await service.getMyPromptSettings(b)).effectivePrompt.content, 'Admin B private default');

        const library = await service.createLibraryPrompt(a, { name: 'QA profile prompt', content: 'Assigned library content' });
        await tx.user.update({ where: { id: a.id }, data: { selectedPromptId: library.id, useMasterPrompt: false } });
        await service.updateMyPromptSettings(a, { content: 'Private copy of library default' });
        assert.equal((await tx.promptVersion.findUnique({ where: { id: library.id } })).content, 'Assigned library content');
        assert.notEqual((await service.getMyPromptSettings(a)).effectivePrompt.id, library.id);

        const bidder = await tx.user.create({ data: { email: `${marker}-bidder@qa.invalid`, passwordHash: 'not-a-login-hash', firstName: 'Bidder', lastName: 'QA', role: 'BIDDER', managedByAdminId: a.id } });
        assert.equal((await service.resolvePromptForUser(bidder)).id, shared.id, 'admin personal defaults must not leak to bidders');
        await assert.rejects(service.updateMyPromptSettings(bidder, { content: 'Not allowed' }));
        await assert.rejects(service.updateMyPromptSettings(a, { mode: 'invalid', content: 'Must not be saved' }));
        await assert.rejects(service.updateMyPromptSettings(a, { mode: 'user', content: ' ' }));
        assert.equal((await service.getMyPromptSettings(a)).effectivePrompt.content, 'Private copy of library default');

        saved = await service.updateMyPromptSettings(a, { resetToDefault: true, mode: 'user' });
        assert.equal(saved.effectivePrompt.id, shared.id);
        assert.equal((await service.getMyPromptSettings(b)).effectivePrompt.content, 'Admin B private default');
        throw rollback;
      }, { timeout: 30000 });
    } catch (error) {
      if (error !== rollback) throw error;
    }
    assert.equal(await prisma.user.count({ where: { id: { in: ids } } }), 0);
    console.log('PASS: private defaults, two-admin isolation, profile/single modes, fallback warnings, immutable copies, assignment restrictions, bidder isolation, reset and validation. All database test writes rolled back.');
  } finally {
    await prisma.$disconnect();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
