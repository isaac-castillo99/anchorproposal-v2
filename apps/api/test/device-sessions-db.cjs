// Isolated real-DB checks. All session/user/generation writes roll back.
require('reflect-metadata');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const bcrypt = require('bcrypt');
const { ConfigModule, ConfigService } = require('@nestjs/config');
const { JwtService } = require('@nestjs/jwt');
const { PrismaClient } = require('@prisma/client');
const { AuthService } = require('../dist/auth/auth.service');
const { JwtStrategy } = require('../dist/auth/jwt.strategy');
const { GenerationsService } = require('../dist/generations/generations.service');
const { AnswersService } = require('../dist/generations/answers.service');
const { DeepseekService } = require('../dist/deepseek/deepseek.service');
(async () => {
  await ConfigModule.forRoot(); const prisma = new PrismaClient(); const rollback = new Error('QA rollback');
  try {
    await prisma.$transaction(async tx => {
      const db = new Proxy(tx, { get: (target, key) => key === '$transaction' ? fn => typeof fn === 'function' ? fn(db) : Promise.all(fn) : target[key] });
      const config = new ConfigService({ JWT_SECRET: 'device-qa-access', JWT_REFRESH_SECRET: 'device-qa-refresh' });
      const jwt = new JwtService(); const auth = new AuthService(db, jwt, config, {}); const strategy = new JwtStrategy(config, db);
      const user = await tx.user.create({ data: { email: `${randomUUID()}@qa.invalid`, firstName: 'Device', lastName: 'QA', role: 'ADMIN', passwordHash: await bcrypt.hash('qa-only-password', 4) } });
      const web = await auth.login({ email: user.email, password: 'qa-only-password' });
      const desktop = await auth.login({ email: user.email, password: 'qa-only-password' });
      const webSession = jwt.decode(web.accessToken).sid; const desktopSession = jwt.decode(desktop.accessToken).sid;
      assert.notEqual(webSession, desktopSession); assert.equal(await tx.authSession.count({ where: { userId: user.id } }), 2);
      const stored = await tx.authSession.findUnique({ where: { id: desktopSession } }); assert.equal(stored.refreshTokenHash, createHash('sha256').update(desktop.refreshToken).digest('hex')); assert.notEqual(stored.refreshTokenHash, desktop.refreshToken);
      const renewedWeb = await auth.refresh(web.refreshToken); const renewedDesktop = await auth.refresh(desktop.refreshToken);
      await assert.rejects(auth.refresh(desktop.refreshToken), /Invalid refresh/);
      assert.equal((await strategy.validate(jwt.decode(renewedDesktop.accessToken))).sessionId, desktopSession);
      await auth.logout(user.id, desktopSession); await assert.rejects(strategy.validate(jwt.decode(renewedDesktop.accessToken)), /Session expired/);
      await assert.rejects(auth.refresh(renewedDesktop.refreshToken), /Invalid refresh/); await auth.refresh(renewedWeb.refreshToken);
      await auth.changePassword(user, { currentPassword: 'qa-only-password', newPassword: 'new-qa-only-password', confirmPassword: 'new-qa-only-password' });
      assert.equal(await tx.authSession.count({ where: { userId: user.id } }), 0);
      console.log('PASS: independent web/desktop sessions, hashed refresh storage, rotation/replay rejection, per-device logout, access revocation and password-change revocation.');

      const app = await tx.application.findFirst({ where: { bidder: { canGenerateResumes: true, role: { in: ['ADMIN', 'BIDDER'] } } }, include: { bidder: true } });
      const template = await tx.templateVersion.findFirst({ where: { isPublished: true } }); const prompt = await tx.promptVersion.findFirst({ where: { isPublished: true } });
      assert.ok(app && template && prompt);
      const snapshot = { firstName: 'Device', lastName: 'QA', experiences: [] };
      const settings = { requireApiKey: async () => 'qa-mock-key', resolveGenerationPrompt: async () => ({ prompt }) };
      const deepseek = new DeepseekService(settings);
      deepseek.generate = async (_, __, options) => { options.onProgress(100); return { content: { contact: { name: 'Device QA' }, summary: 'QA', skills: [], experiences: [], educations: [], certificates: [] }, tokenUsage: 12, transcript: [{ role: 'system', content: 'QA system' }, { role: 'user', content: 'QA job' }, { role: 'assistant', content: 'QA response' }] }; };
      const generations = new GenerationsService(db, { checkAccess: async () => {}, findOne: async () => snapshot, buildProfileSnapshot: p => p }, { canGenerate: () => ({ allowed: true }) }, settings, { resolveDefaultTemplateId: async () => template.id }, {}, { add: () => { throw new Error('unexpected queue call'); } }, deepseek);
      const events = []; const input = { idempotencyKey: randomUUID() }; await generations.streamDesktopGeneration(app.id, app.bidder, input, new AbortController().signal, e => events.push(e));
      const generationId = events.at(-1).generationId; const saved = await tx.resumeGeneration.findUnique({ where: { id: generationId } }); assert.equal(saved.status, 'COMPLETED');
      assert.equal(await tx.generationTurn.count({ where: { generationId } }), 3); assert.equal(await tx.auditEvent.count({ where: { targetId: generationId } }), 1);
      await generations.streamDesktopGeneration(app.id, app.bidder, input, new AbortController().signal, e => events.push(e)); assert.equal(events.at(-1).generationId, generationId);
      console.log('PASS: real SQL stream reservation, completed resume, conversation, audit and idempotent replay; zero AI calls.');
      assert.equal(saved.structuredOutputJson.contact.name, 'Device QA');
      settings.getAnswerPrompt = async () => 'Answer application questions using the saved resume.';
      let chatCalls = 0;
      deepseek.completeChat = async () => ({ content: ++chatCalls === 1 ? 'yes' : 'I build reliable services for distributed teams.', tokenUsage: 5 });
      const answers = new AnswersService(db, settings, deepseek, generations);
      await answers.ask(generationId, app.bidder, 'What experience do you bring?');
      // A fresh service instance represents reopening the desktop or reading from another API worker.
      const reopened = new AnswersService(db, settings, deepseek, generations);
      const restored = await reopened.list(generationId, app.bidder);
      assert.equal(restored.primed, true);
      assert.deepEqual(restored.items, [{ question: 'What experience do you bring?', answer: 'I build reliable services for distributed teams.' }]);
      assert.equal(await tx.generationTurn.count({ where: { generationId } }), 7);
      assert.equal(chatCalls, 2);
      console.log('PASS: generated resume and answer chat persist in the server database and reload in a fresh service; zero external provider calls.');
      throw rollback;
    }, { timeout: 60000 });
  } catch (error) { if (error !== rollback) throw error; console.log('All test database writes rolled back.'); }
  finally { await prisma.$disconnect(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
