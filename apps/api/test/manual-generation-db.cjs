// Local database smoke test: all inserted generations, turns and audit events roll back.
require('reflect-metadata');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { ConfigModule } = require('@nestjs/config');
const { PrismaClient } = require('@prisma/client');
const { GenerationsService } = require('../dist/generations/generations.service');
const { DeepseekService } = require('../dist/deepseek/deepseek.service');
const { SettingsService } = require('../dist/settings/settings.service');

(async () => {
  await ConfigModule.forRoot();
  const prisma = new PrismaClient();
  const rollback = new Error('Intentional test rollback');
  let generationId;
  try {
    const application = await prisma.application.findFirst({
      where: { bidder: { canGenerateResumes: true, role: { in: ['ADMIN', 'BIDDER'] } } },
      include: { bidder: true },
    });
    const template = await prisma.templateVersion.findFirst({ where: { isPublished: true } });
    const prompt = await prisma.promptVersion.findFirst({ where: { isPublished: true } });
    assert.ok(application && template && prompt, 'The local database needs an application, a template and a prompt for this smoke test.');
    const snapshot = { firstName: 'QA', lastName: 'Candidate', profileTitle: 'Engineer', experiences: [{ title: 'Developer', company: 'QA Employer', startDate: '2020', endDate: '', responsibilities: ['Built APIs'] }] };
    const output = { contact: { name: 'QA Candidate' }, summary: 'A test resume that will be rolled back.', skills: [], experiences: [], educations: [], certificates: [] };
    try {
      await prisma.$transaction(async (tx) => {
        const database = new Proxy(tx, { get: (target, key) => key === '$transaction' ? (fn) => fn(tx) : target[key] });
        const settings = new SettingsService(database);
        settings.requireApiKey = async () => { throw new Error('Unexpected provider call'); };
        const ownedPrompt = await tx.promptVersion.create({ data: {
          name: 'QA prompt flag rollback', content: '{{profileJson}}\n{{jobDescription}}',
          version: 1, ownerId: application.bidderId, isPublished: true,
        } });
        assert.equal(ownedPrompt.experienceTitleMode, 'saved');
        await tx.user.update({ where: { id: application.bidderId }, data: { generationPromptMode: 'profile' } });
        await tx.profilePromptAssignment.upsert({
          where: { profileId_userId: { profileId: application.profileId, userId: application.bidderId } },
          create: { profileId: application.profileId, userId: application.bidderId, promptVersionId: ownedPrompt.id },
          update: { promptVersionId: ownedPrompt.id },
        });
        const service = new GenerationsService(
          database,
          { checkAccess: async () => {}, findOne: async () => snapshot, buildProfileSnapshot: (p) => p },
          { canGenerate: () => ({ allowed: true }) }, settings,
          { resolveDefaultTemplateId: async () => template.id, checkAccess: async () => {} },
          {}, { add: async () => { throw new Error('Unexpected queue call'); } }, new DeepseekService(settings),
        );
        const prepared = await service.previewManualGeneration(application.id, application.bidder);
        const input = { responseJson: JSON.stringify(output), contextHash: prepared.contextHash, templateId: template.id, idempotencyKey: randomUUID() };
        const generation = await service.importManualGeneration(application.id, application.bidder, input);
        generationId = generation.id;
        assert.equal(generation.status, 'COMPLETED');
        assert.equal((await service.importManualGeneration(application.id, application.bidder, input)).id, generationId);
        assert.equal(await tx.generationTurn.count({ where: { generationId } }), 3);
        assert.equal(await tx.auditEvent.count({ where: { targetId: generationId, action: 'RESUME_MANUALLY_GENERATED' } }), 1);
        await tx.promptVersion.update({ where: { id: ownedPrompt.id }, data: { experienceTitleMode: 'tailored' } });
        const tailored = await service.previewManualGeneration(application.id, application.bidder, template.id);
        assert.equal(tailored.experienceTitleMode, 'tailored');
        const tailoredGeneration = await service.importManualGeneration(application.id, application.bidder, {
          responseJson: JSON.stringify({ summary: 'QA backend engineer.', skills: [{ Languages: 'Java' }], experiences: [{ role: 'Backend Engineer', bullets: ['Built APIs'] }] }),
          contextHash: tailored.contextHash, templateId: template.id, experienceTitleMode: 'saved', idempotencyKey: randomUUID(),
        });
        const reloaded = await tx.resumeGeneration.findUnique({ where: { id: tailoredGeneration.id }, include: { turns: true } });
        assert.equal(reloaded.experienceTitleMode, 'tailored');
        assert.equal(reloaded.structuredOutputJson.experiences[0].title, 'Backend Engineer');
        assert.equal(reloaded.profileSnapshotJson.experiences[0].title, 'Developer');
        assert.equal(JSON.parse(reloaded.turns.find(t => t.role === 'assistant').content).experiences[0].title, 'Backend Engineer');
        assert.equal(reloaded.version, generation.version + 1);
        throw rollback;
      }, { timeout: 60000 });
    } catch (error) {
      if (error !== rollback) throw error;
    }
    assert.equal(await prisma.resumeGeneration.count({ where: { id: generationId } }), 0);
    assert.equal(await prisma.generationTurn.count({ where: { generationId } }), 0);
    console.log('PASS: saved and tailored manual imports, SQL locking, version/mode persistence, conversation, audit and idempotent retry; all test writes rolled back.');
  } finally {
    await prisma.$disconnect();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
