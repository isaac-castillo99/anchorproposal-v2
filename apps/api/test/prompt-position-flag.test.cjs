require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SettingsService } = require('../dist/settings/settings.service');

function fixture() {
  const admin = { id: 'a1', role: 'ADMIN' };
  const state = { mode: 'profile', override: null, prompts: [
    { id: 'default', name: 'Default', ownerId: null, isInitial: true, isPersonalDefault: false, isPublished: true, experienceTitleMode: 'saved', content: 'Default text', version: 1 },
    { id: 'match', name: 'JD Role Match Prompt', ownerId: 'a1', isInitial: false, isPersonalDefault: false, isPublished: true, experienceTitleMode: 'tailored', content: 'Existing role match instructions', version: 1 },
    { id: 'private', name: 'My default', ownerId: 'a1', isInitial: false, isPersonalDefault: true, isPublished: true, experienceTitleMode: 'saved', content: 'Private text', version: 2 },
  ] };
  const matches = (p, where) => Object.entries(where).every(([k, v]) => p[k] === v);
  const prisma = {
    promptVersion: {
      findUnique: async ({ where }) => state.prompts.find(p => p.id === where.id),
      findFirst: async ({ where }) => state.prompts.find(p => matches(p, where)),
      findMany: async ({ where }) => state.prompts.filter(p => matches(p, where)),
      create: async ({ data }) => { const row = { id: 'new', isInitial: false, isPersonalDefault: false, ...data }; state.prompts.push(row); return row; },
      update: async ({ where, data }) => Object.assign(state.prompts.find(p => p.id === where.id), data),
      updateMany: async ({ where, data }) => { state.prompts.filter(p => matches(p, where)).forEach(p => Object.assign(p, data)); },
    },
    user: { findUnique: async () => ({ generationPromptMode: state.mode, useMasterPrompt: true }) },
    profile: { findUnique: async () => ({ id: 'p1', firstName: 'Alex', lastName: 'Example', assignedPrompt: state.prompts.find(p => p.id === 'match') }) },
    profilePromptAssignment: { findUnique: async () => state.override ? { promptVersion: state.override } : null },
  };
  return { admin, state, service: new SettingsService(prisma) };
}

test('prompt create defaults to fixed and a flag-only edit preserves all prompt text', async () => {
  const f = fixture(); const created = await f.service.createLibraryPrompt(f.admin, { name: 'Custom', content: 'Keep exactly this text.' });
  assert.equal(created.experienceTitleMode, 'saved');
  const updated = await f.service.updateLibraryPrompt(f.admin, created.id, { experienceTitleMode: 'tailored' });
  assert.equal(updated.experienceTitleMode, 'tailored'); assert.equal(updated.content, 'Keep exactly this text.');
  assert.equal((await f.service.updateLibraryPrompt(f.admin, created.id, { name: 'Renamed' })).experienceTitleMode, 'tailored');
});

test('initial and personal defaults cannot become role-match prompts, including through flag-only API writes', async () => {
  const f = fixture();
  await assert.rejects(f.service.updateLibraryPrompt({ id: 'master', role: 'MASTER' }, 'default', { experienceTitleMode: 'tailored' }), e => e.getStatus() === 400);
  await assert.rejects(f.service.updateLibraryPrompt(f.admin, 'private', { experienceTitleMode: 'tailored' }), e => e.getStatus() === 400);
  for (const value of ['invalid', null, true, {}]) await assert.rejects(f.service.createLibraryPrompt(f.admin, { name: 'Test', content: 'Text', experienceTitleMode: value }), e => e.getStatus() === 400);
});

test('only the owner can change a library prompt flag; bidders cannot add flags or prompts', async () => {
  const f = fixture();
  for (const actor of [{ id: 'other', role: 'ADMIN' }, { id: 'master', role: 'MASTER' }, { id: 'a1', role: 'BIDDER' }]) {
    await assert.rejects(f.service.updateLibraryPrompt(actor, 'match', { experienceTitleMode: 'saved' }), e => e.getStatus() === 403);
  }
  await assert.rejects(f.service.createLibraryPrompt({ id: 'b1', role: 'BIDDER' }, { name: 'Test', content: 'Text', experienceTitleMode: 'tailored' }), e => e.getStatus() === 403);
  assert.equal(f.state.prompts[1].experienceTitleMode, 'tailored');
});

test('profile assignments and per-user profile overrides resolve the prompt flag; defaults stay fixed', async () => {
  const f = fixture();
  assert.equal((await f.service.resolveGenerationPrompt(f.admin, 'p1')).experienceTitleMode, 'tailored');
  assert.equal((await f.service.resolveGenerationPrompt({ id: 'b1', role: 'BIDDER' }, 'p1')).experienceTitleMode, 'tailored');
  f.state.override = f.state.prompts[0];
  assert.equal((await f.service.resolveGenerationPrompt(f.admin, 'p1')).experienceTitleMode, 'saved');
  f.state.override = null; f.state.mode = 'user';
  assert.equal((await f.service.resolveGenerationPrompt(f.admin, 'p1')).experienceTitleMode, 'saved');
  f.state.mode = 'profile'; f.state.prompts.splice(1, 1);
  const fallback = await f.service.resolveGenerationPrompt(f.admin, 'p1');
  assert.equal(fallback.usedDefault, true); assert.equal(fallback.experienceTitleMode, 'saved');
});

test('promoting a shared role-match prompt to the initial default resets only its flag', async () => {
  const f = fixture(); f.state.prompts[1].ownerId = null;
  const promoted = await f.service.publishMasterPrompt('match');
  assert.equal(promoted.isInitial, true); assert.equal(promoted.experienceTitleMode, 'saved');
  assert.equal(promoted.content, 'Existing role match instructions');
});
