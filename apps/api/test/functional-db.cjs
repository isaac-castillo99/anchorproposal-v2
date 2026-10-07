// Local service integration checks. All fixtures and changes are rolled back;
// mail is captured in memory and no AI provider or generation queue is used.
require('reflect-metadata');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { ConfigModule, ConfigService } = require('@nestjs/config');
const { JwtService } = require('@nestjs/jwt');
const { PrismaClient } = require('@prisma/client');
const { SettingsService } = require('../dist/settings/settings.service');
const { UsersService } = require('../dist/users/users.service');
const { ProfilesService } = require('../dist/profiles/profiles.service');
const { AuthService } = require('../dist/auth/auth.service');
const { ApplicationsService } = require('../dist/applications/applications.service');
const { ApplicationOptionsService } = require('../dist/applications/application-options.service');
const { RulesService } = require('../dist/rules/rules.service');
const { DashboardService } = require('../dist/dashboard/dashboard.service');
const { TemplatesService } = require('../dist/templates/templates.service');
const { TemplatesController } = require('../dist/templates/templates.controller');

(async () => {
  await ConfigModule.forRoot();
  const prisma = new PrismaClient();
  const marker = randomUUID();
  const rollback = new Error('Intentional functional QA rollback');
  let checks = 0;
  const check = (name) => { checks++; console.log(`PASS ${name}`); };
  const safe = (value) => {
    assert.ok(!/"(passwordHash|refreshToken)"\s*:/.test(JSON.stringify(value)), 'user response leaked authentication fields');
    return value;
  };
  try {
    try {
      await prisma.$transaction(async (tx) => {
        const db = new Proxy(tx, { get: (target, key) => key === '$transaction' ? (fn) => typeof fn === 'function' ? fn(db) : Promise.all(fn) : target[key] });
        const settings = new SettingsService(db);
        const users = new UsersService(db, settings);
        const profiles = new ProfilesService(db, settings);
        const mail = {};
        const auth = new AuthService(db, new JwtService(), new ConfigService({ JWT_SECRET: 'functional-qa-access', JWT_REFRESH_SECRET: 'functional-qa-refresh' }), {
          sendOtp: async (email, purpose, code) => { mail.code = code; },
          sendResetLink: async (email, token) => { mail.token = token; },
        });
        const master = await tx.user.create({ data: { email: `${marker}-master@qa.invalid`, firstName: 'QA', lastName: 'Master', role: 'MASTER', passwordHash: 'not-login-capable' } });
        const admin = safe(await users.create({ email: `${marker}-admin@qa.invalid`, firstName: 'QA', lastName: 'Admin', role: 'ADMIN' }, master));
        const otherAdmin = safe(await users.create({ email: `${marker}-other@qa.invalid`, firstName: 'QA', lastName: 'Other', role: 'ADMIN' }, master));
        const bidder = safe(await users.create({ email: `${marker}-bidder@qa.invalid`, firstName: 'QA', lastName: 'Bidder', password: 'qa-only-password' }, admin));
        safe(await users.findAll(master));
        assert.deepEqual(safe(await users.findAll(admin)).map((u) => u.id), [bidder.id]);
        await assert.rejects(users.update(bidder.id, { firstName: 'Wrong' }, otherAdmin), /cannot update/);
        safe(await users.update(bidder.id, { firstName: 'Updated' }, admin));
        check('User create, edit, list, ownership and credential-free responses');

        safe(await users.updatePermissions(bidder.id, { canGenerateResumes: false, role: 'MASTER', passwordHash: 'injected', managedByAdminId: otherAdmin.id }, admin));
        let stored = await tx.user.findUnique({ where: { id: bidder.id } });
        assert.equal(stored.role, 'BIDDER'); assert.equal(stored.managedByAdminId, admin.id); assert.notEqual(stored.passwordHash, 'injected');
        await assert.rejects(users.updatePermissions(bidder.id, { canGenerateResumes: 'false' }, admin), /boolean/);
        safe(await users.updatePermissions(bidder.id, { canGenerateResumes: true }, admin));
        check('Permission toggles reject invalid values and cannot alter role, password or ownership');

        const profile = await profiles.create({ firstName: 'QA', lastName: 'Profile',
          experiences: [{ title: 'Engineer', company: 'QA Company' }],
          education: [{ institution: 'QA University', degree: 'BS' }],
          skills: [{ category: 'Languages', name: 'Java' }],
          certifications: [{ name: 'QA Certificate' }],
          links: [{ type: 'Portfolio', url: 'https://example.com' }],
        });
        const copy = await profiles.clone(profile.id);
        assert.notEqual(copy.experiences[0].id, profile.experiences[0].id);
        assert.equal(copy.experiences[0].profileId, copy.id);
        const edited = await profiles.update(profile.id, { summary: 'Changed summary only' });
        for (const key of ['experiences', 'education', 'skills', 'certifications', 'links']) {
          assert.equal(edited[key][0].id, profile[key][0].id);
          assert.notEqual(copy[key][0].id, profile[key][0].id);
        }
        await assert.rejects(profiles.update(profile.id, { experiences: [{ company: 'Missing title' }] }));
        assert.equal((await profiles.findOne(profile.id, admin)).experiences[0].id, profile.experiences[0].id);
        const replaced = await profiles.update(profile.id, { experiences: edited.experiences });
        assert.equal(replaced.experiences.length, 1);
        check('Profile clone generates fresh child IDs; partial edits preserve child records');

        safe(await users.updateAssignments(bidder.id, [{ profileId: profile.id, isDefault: false }, { profileId: copy.id, isDefault: false }], admin));
        assert.equal((await profiles.getDefaultProfile(bidder.id)).id, profile.id);
        for (const invalid of [[{ profileId: randomUUID() }], [{ profileId: profile.id }, { profileId: profile.id }], [{ profileId: profile.id, isDefault: true }, { profileId: copy.id, isDefault: true }]]) {
          await assert.rejects(users.updateAssignments(bidder.id, invalid, admin));
          assert.equal((await profiles.getAssignedProfiles(bidder.id)).length, 2);
        }
        await assert.rejects(users.updateAssignments(bidder.id, [], otherAdmin), /own bidders/);
        await profiles.setDefaultProfile(copy.id, bidder);
        assert.equal((await profiles.getDefaultProfile(bidder.id)).id, copy.id);
        check('Profile assignment validation preserves existing assignments and one default');

        const prompt = await settings.createLibraryPrompt(admin, { name: 'QA prompt', content: 'QA content' });
        await assert.rejects(profiles.updateProfilePromptAssignments(profile.id, [{ userId: otherAdmin.id, promptVersionId: prompt.id }], admin, prompt.id));
        assert.equal((await profiles.findOne(profile.id, admin)).promptVersionId, null);
        safe(await users.updatePromptAssignments(bidder.id, [{ promptVersionId: prompt.id }], admin));
        safe(await users.updatePromptAssignment(bidder.id, { useMasterPrompt: false, content: 'Bidder prompt' }, admin));
        safe(await users.updateManagedBy(bidder.id, otherAdmin.id, master));
        await assert.rejects(users.updateStatus(bidder.id, 'SUSPENDED', admin));
        safe(await users.updateManagedBy(bidder.id, admin.id, master));
        check('Prompt assignment and bidder ownership reassignment');

        const templates = new TemplatesService(db);
        const templateController = new TemplatesController(templates);
        const template = await templates.create({ name: 'QA template' });
        await assert.rejects(templateController.findOne(template.id, { user: bidder }));
        await templates.publish(template.id);
        await assert.rejects(templateController.preview(template.id, { user: bidder }));
        safe(await users.updateTemplateAssignments(bidder.id, [{ templateVersionId: template.id, isDefault: false }], admin));
        assert.equal(await templates.resolveDefaultTemplateId(bidder), template.id);
        assert.ok((await templateController.preview(template.id, { user: bidder })).html.includes('Alexandra Chen'));
        await templates.update(template.id, { name: 'QA edited template' });
        const clonedTemplate = await templates.clone(template.id);
        await templates.archive(clonedTemplate.id);
        assert.ok(!(await templates.findAllForUser(admin)).some((t) => t.id === clonedTemplate.id));
        check('Template CRUD, publish, clone, archive, default and restricted previews');

        const login = await auth.login({ email: bidder.email, password: 'qa-only-password' });
        safe(login.user); safe(await auth.getMe(bidder));
        const refreshed = await auth.refresh(login.refreshToken);
        assert.ok(refreshed.accessToken);
        assert.notEqual(refreshed.refreshToken, login.refreshToken);
        await assert.rejects(auth.refresh(login.refreshToken), /Invalid refresh/);
        await auth.logout(bidder.id);
        await assert.rejects(auth.refresh(refreshed.refreshToken), /Invalid refresh/);
        safe(await users.updateStatus(bidder.id, 'SUSPENDED', admin));
        await assert.rejects(auth.login({ email: bidder.email, password: 'qa-only-password' }), /disallowed/);
        safe(await users.updateStatus(bidder.id, 'ACTIVE', admin));
        await assert.rejects(auth.login({ email: bidder.email, password: 'wrong' }), /Invalid credentials/);
        check('Login, refresh, logout, suspended access and invalid credentials');

        const registration = { email: `${marker}-signup@qa.invalid`, firstName: 'QA', lastName: 'Signup', password: 'qa-signup-password', confirmPassword: 'qa-signup-password' };
        await auth.requestRegisterOtp(registration);
        const registered = await auth.verifyRegister({ email: registration.email, code: mail.code });
        safe(registered.user); assert.equal(registered.user.status, 'PENDING');
        await assert.rejects(auth.verifyRegister({ email: registration.email, code: mail.code }));
        await assert.rejects(auth.login({ email: registration.email, password: registration.password }), /pending/);
        await auth.forgotPassword({ email: bidder.email });
        await auth.resetPassword({ token: mail.token, password: 'qa-new-password', confirmPassword: 'qa-new-password' });
        await assert.rejects(auth.resetPassword({ token: mail.token, password: 'qa-new-password', confirmPassword: 'qa-new-password' }));
        await auth.login({ email: bidder.email, password: 'qa-new-password' });
        await auth.changePassword(bidder, { currentPassword: 'qa-new-password', newPassword: 'qa-final-password', confirmPassword: 'qa-final-password' });
        await auth.login({ email: bidder.email, password: 'qa-final-password' });
        check('OTP signup, pending approval, password reset and change with captured mail');

        const options = new ApplicationOptionsService(db);
        await options.list(bidder);
        const option = await options.create(bidder, { type: 'LOCATION', value: 'QA Remote', isDefault: true });
        await assert.rejects(options.update(option.id, otherAdmin, { value: 'Not yours' }));
        await options.update(option.id, bidder, { value: 'QA Anywhere' });
        await options.remove(option.id, bidder);
        check('Application option create, edit, delete and ownership');

        const rules = new RulesService(db);
        await assert.rejects(rules.createRule({ category: 'CLEARANCE', pattern: '[', severity: 'CONFIRM', behavior: 'CONFIRM' }), /regular expression/);
        const rule = await rules.createRule({ category: 'TRAVEL_LOCATION', pattern: 'QA travel', severity: 'CONFIRM', behavior: 'CONFIRM' });
        await assert.rejects(rules.updateRule(rule.id, { pattern: '(' }), /regular expression/);
        await rules.updateRule(rule.id, { pattern: 'QA relocation' });
        const apps = new ApplicationsService(db, profiles, rules, { deleteResumeTree: async () => {} });
        const app = await apps.create({ profileId: profile.id, jobTitle: 'QA Engineer', company: `${marker} Hiring`, jobDescription: 'Remote engineering role.', workArrangement: 'REMOTE' }, bidder);
        assert.ok((await apps.findAll(bidder, {})).some((a) => a.id === app.id));
        assert.ok(!(await apps.findAll(otherAdmin, {})).some((a) => a.id === app.id));
        await assert.rejects(apps.findOne(app.id, otherAdmin), /Access denied/);
        await apps.update(app.id, { jobTitle: 'QA Senior Engineer' }, bidder);
        await apps.addNote(app.id, 'QA note', bidder);
        const warning = await tx.applicationWarning.create({ data: { applicationId: app.id, category: 'CLEARANCE', matchedText: 'Clearance is required.', severity: 'CONFIRM', behavior: 'CONFIRM' } });
        await assert.rejects(apps.acknowledgeWarning(warning.id, otherAdmin), /Access denied/);
        assert.ok((await apps.acknowledgeWarning(warning.id, bidder)).acknowledgedAt);
        await apps.updateStatus(app.id, 'APPLIED', bidder);
        const detail = await apps.findOne(app.id, admin);
        assert.equal(detail.notes[0].content, 'QA note'); assert.equal(detail.statusHistory.length, 2);
        const metrics = await new DashboardService(db).getMetrics(admin, { bidderIds: [bidder.id] });
        assert.equal(metrics.kpis.total, 1); assert.equal(metrics.kpis.applied, 1);
        await apps.remove(app.id, bidder);
        await assert.rejects(apps.findOne(app.id, bidder), /not found/);
        check('Application CRUD, notes, status history, team isolation and dashboard totals');

        await profiles.archive(copy.id);
        assert.ok(!(await profiles.findAll(bidder)).some((p) => p.id === copy.id));
        await users.remove(bidder.id, admin);
        assert.equal(await tx.user.findUnique({ where: { id: bidder.id } }), null);
        check('Profile archive and eligible user deletion');
        throw rollback;
      }, { timeout: 180000, maxWait: 15000 });
    } catch (error) { if (error !== rollback) throw error; }
    assert.equal(await prisma.user.count({ where: { email: { startsWith: marker } } }), 0);
    console.log(`${checks} workflow groups passed; all fixtures rolled back.`);
  } finally { await prisma.$disconnect(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
