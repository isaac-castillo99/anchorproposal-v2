// Real database regression: all fixture writes are rolled back.
require('reflect-metadata');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { ConfigModule } = require('@nestjs/config');
const { PrismaClient } = require('@prisma/client');
const { SettingsService } = require('../dist/settings/settings.service');

(async () => {
  await ConfigModule.forRoot();
  const db = new PrismaClient();
  const marker = randomUUID();
  const rollback = new Error('Intentional prompt-removal rollback');
  let promptId;
  try {
    try {
      await db.$transaction(async tx => {
        const service = new SettingsService(new Proxy(tx, { get: (target, key) => key === '$transaction' ? fn => fn(tx) : target[key] }));
        const admin = await tx.user.create({ data: { email: `${marker}@qa.invalid`, passwordHash: 'not-a-login-hash', firstName: 'Prompt', lastName: 'QA', role: 'ADMIN' } });
        const prompt = await service.createLibraryPrompt(admin, { name: 'Removal QA', content: 'Preserve resume history.', experienceTitleMode: 'tailored' });
        promptId = prompt.id;
        const profile = await tx.profile.create({ data: { firstName: 'Prompt', lastName: 'QA', promptVersionId: prompt.id } });
        await tx.user.update({ where: { id: admin.id }, data: { selectedPromptId: prompt.id, useMasterPrompt: false } });
        await tx.promptAssignment.create({ data: { userId: admin.id, promptVersionId: prompt.id, isDefault: true } });
        const bidder = await tx.user.create({ data: { email: `${marker}-bidder@qa.invalid`, passwordHash: 'not-a-login-hash', firstName: 'Bidder', lastName: 'QA', role: 'BIDDER', managedByAdminId: admin.id, useMasterPrompt: false } });
        await tx.promptAssignment.create({ data: { userId: bidder.id, promptVersionId: prompt.id, isDefault: true } });
        await tx.profilePromptAssignment.create({ data: { userId: admin.id, profileId: profile.id, promptVersionId: prompt.id } });
        const application = await tx.application.create({ data: { bidderId: admin.id, profileId: profile.id, jobTitle: 'QA', company: 'QA', normalizedCompany: 'qa', jobDescription: 'QA' } });
        const generation = await tx.resumeGeneration.create({ data: { applicationId: application.id, creatorId: admin.id, promptVersionId: prompt.id, status: 'COMPLETED', structuredOutputJson: { summary: 'Saved resume' } } });
        const turn = await tx.generationTurn.create({ data: { generationId: generation.id, sequence: 1, role: 'assistant', purpose: 'answer', content: 'Saved answer' } });

        for (const actor of [{ id: 'other', role: 'ADMIN' }, { id: admin.id, role: 'BIDDER' }, { id: 'master', role: 'MASTER' }]) {
          await assert.rejects(service.deleteLibraryPrompt(actor, prompt.id), e => e.getStatus() === 403);
        }
        await service.deleteLibraryPrompt(admin, prompt.id);
        const archived = await tx.promptVersion.findUnique({ where: { id: prompt.id } });
        assert.ok(archived.archivedAt);
        assert.equal(archived.isPublished, false);
        assert.equal(archived.content, prompt.content);
        assert.equal(archived.experienceTitleMode, 'tailored');
        assert.deepEqual(await tx.resumeGeneration.findUnique({ where: { id: generation.id } }), generation);
        assert.deepEqual(await tx.generationTurn.findUnique({ where: { id: turn.id } }), turn);
        assert.equal(await tx.promptAssignment.count({ where: { promptVersionId: prompt.id } }), 0);
        assert.equal(await tx.profilePromptAssignment.count({ where: { promptVersionId: prompt.id } }), 0);
        assert.equal((await tx.profile.findUnique({ where: { id: profile.id } })).promptVersionId, null);
        const updatedUser = await tx.user.findUnique({ where: { id: admin.id } });
        assert.equal(updatedUser.selectedPromptId, null);
        assert.equal(updatedUser.useMasterPrompt, true);
        assert.equal((await tx.user.findUnique({ where: { id: bidder.id } })).useMasterPrompt, true);
        assert.notEqual((await service.resolvePromptForUser(bidder)).id, prompt.id);
        for (const actor of [admin, { id: 'master', role: 'MASTER' }]) {
          assert.ok(!(await service.listManagedPrompts(actor)).some(p => p.id === prompt.id));
          assert.ok(!(await service.listAssignablePrompts(actor)).some(p => p.id === prompt.id));
          await assert.rejects(service.assertAssignablePrompts(actor, [prompt.id]), e => e.getStatus() === 400);
        }
        await assert.rejects(service.updateLibraryPrompt(admin, prompt.id, { content: 'Invalid' }), e => e.getStatus() === 404);
        await assert.rejects(service.deleteLibraryPrompt(admin, prompt.id), e => e.getStatus() === 404);
        await assert.rejects(service.publishMasterPrompt(prompt.id), e => e.getStatus() === 404);
        // A stale reference must never reactivate an archived prompt.
        await tx.profile.update({ where: { id: profile.id }, data: { promptVersionId: prompt.id } });
        await tx.profilePromptAssignment.create({ data: { userId: admin.id, profileId: profile.id, promptVersionId: prompt.id } });
        const fallback = await service.resolveGenerationPrompt(admin, profile.id);
        assert.notEqual(fallback.prompt.id, prompt.id);
        assert.equal(fallback.experienceTitleMode, 'saved');
        throw rollback;
      }, { timeout: 30000 });
    } catch (error) { if (error !== rollback) throw error; }
    assert.equal(await db.promptVersion.count({ where: { id: promptId } }), 0);
    console.log('PASS: owner permissions, library removal, assignment cleanup, preserved resume and answer history, archived write rejection, stale-reference fallback. All test writes rolled back.');
  } finally { await db.$disconnect(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
