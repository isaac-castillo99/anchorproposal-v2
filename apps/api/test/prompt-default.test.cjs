require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_PROMPT } = require('@anchorproposal/shared');
const { SettingsService } = require('../dist/settings/settings.service');

function fixture(initial = []) {
  const actor = { id: 'admin-a', role: 'ADMIN' };
  const user = { ...actor, useMasterPrompt: false, selectedPromptId: 'private-a', generationPromptMode: 'profile' };
  const privatePrompt = { id: 'private-a', ownerId: actor.id, content: 'Keep my private instructions', isPublished: true, isInitial: false, isPersonalDefault: true, version: 1 };
  const prompts = [privatePrompt, ...initial];
  let writes = 0;
  let failCreate = false;
  const matches = (row, where) => Object.entries(where).every(([key, value]) => row[key] === value);
  const find = ({ where, orderBy = [] }) => {
    const rows = prompts.filter((row) => matches(row, where));
    const orders = Array.isArray(orderBy) ? orderBy : [orderBy];
    return rows.sort((a, b) => {
      for (const order of orders) {
        const [key, direction] = Object.entries(order)[0];
        const comparison = a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0;
        if (comparison) return direction === 'desc' ? -comparison : comparison;
      }
      return 0;
    });
  };
  const prisma = {
    promptVersion: {
      findMany: async (query) => find(query),
      findFirst: async (query) => find(query)[0] ?? null,
      upsert: async ({ where, create }) => {
        if (failCreate) throw new Error('Database unavailable');
        const existing = prompts.find((p) => matches(p, where));
        if (existing) return existing;
        const created = { isPersonalDefault: false, version: 1, ...create };
        prompts.push(created);
        return created;
      },
    },
    user: {
      findUnique: async () => ({ ...user }),
      update: async ({ data }) => { writes++; Object.assign(user, data); return { ...user }; },
    },
    $transaction: async (fn) => fn(prisma),
  };
  return { actor, user, prompts, service: new SettingsService(prisma), get writes() { return writes; }, failCreate() { failCreate = true; } };
}

const shared = (overrides = {}) => ({ id: 'shared', name: 'Shared instructions', content: 'Configured shared instructions', ownerId: null, isPublished: true, isInitial: true, isPersonalDefault: false, publishedAt: new Date('2026-01-01'), version: 1, ...overrides });

test('an unseeded database gets a nonempty, reusable built-in shared default', async () => {
  const f = fixture();
  const prompt = await f.service.getMasterPublishedPrompt();
  assert.equal(prompt.content, DEFAULT_PROMPT);
  assert.ok(prompt.content.includes('{{profileJson}}'));
  assert.equal(prompt.ownerId, null);
  assert.equal(prompt.isPublished, true);
  assert.equal((await f.service.getMasterPublishedPrompt()).id, prompt.id);
  assert.equal(f.prompts.filter((p) => p.ownerId === null).length, 1);
});

test('restore from a private prompt returns the built-in text and uses it for generation', async () => {
  const f = fixture();
  const result = await f.service.updateMyPromptSettings(f.actor, { resetToDefault: true, mode: 'user' });
  assert.equal(result.effectivePrompt.content, DEFAULT_PROMPT);
  assert.equal(result.useMasterPrompt, true);
  assert.equal(result.assignmentMode, 'user');
  assert.equal(f.user.selectedPromptId, null);
  assert.equal((await f.service.resolvePromptForUser(f.actor)).id, result.effectivePrompt.id);
  assert.equal(f.prompts.find((p) => p.id === 'private-a').content, 'Keep my private instructions');
});

test('the published initial prompt wins over newer shared prompts without changing either', async () => {
  const initial = shared();
  const newer = shared({ id: 'newer', isInitial: false, publishedAt: new Date('2026-02-01') });
  const f = fixture([newer, initial]);
  const result = await f.service.updateMyPromptSettings(f.actor, { resetToDefault: true });
  assert.equal(result.effectivePrompt.id, initial.id);
  assert.equal(f.prompts.length, 3);
  assert.equal(initial.content, 'Configured shared instructions');
});

test('blank, unpublished and private records cannot become the shared default', async () => {
  const f = fixture([
    shared({ id: 'draft', isPublished: false }),
    shared({ id: 'blank', content: ' \n\t ' }),
    shared({ id: 'private', isPersonalDefault: true }),
    shared({ id: 'published', isInitial: false }),
  ]);
  assert.equal((await f.service.getMasterPublishedPrompt()).id, 'published');
});

test('invalid shared records do not prevent the built-in fallback', async () => {
  const f = fixture([shared({ content: ' ' }), shared({ id: 'draft', isPublished: false })]);
  assert.equal((await f.service.getMasterPublishedPrompt()).content, DEFAULT_PROMPT);
  assert.equal(f.prompts.find((p) => p.id === 'shared').content, ' ');
});

test('an edited built-in default is preserved', async () => {
  const f = fixture([shared({ id: SettingsService.BUILTIN_DEFAULT_PROMPT_ID, content: 'Master edited these instructions' })]);
  assert.equal((await f.service.getMasterPublishedPrompt()).content, 'Master edited these instructions');
});

test('an unavailable default rejects restore without changing the private prompt or mode', async () => {
  const f = fixture([shared({ id: SettingsService.BUILTIN_DEFAULT_PROMPT_ID, isPublished: false })]);
  await assert.rejects(f.service.updateMyPromptSettings(f.actor, { resetToDefault: true, mode: 'user' }), /current prompt has not been changed/);
  assert.equal(f.writes, 0);
  assert.equal(f.user.selectedPromptId, 'private-a');
  assert.equal(f.user.useMasterPrompt, false);
  assert.equal(f.user.generationPromptMode, 'profile');
});

test('database failure during fallback creation cannot clear an admin selection', async () => {
  const f = fixture();
  f.failCreate();
  await assert.rejects(f.service.updateMyPromptSettings(f.actor, { resetToDefault: true, mode: 'user' }), /Database unavailable/);
  assert.equal(f.writes, 0);
  assert.equal(f.user.selectedPromptId, 'private-a');
  assert.equal(f.user.useMasterPrompt, false);
});
