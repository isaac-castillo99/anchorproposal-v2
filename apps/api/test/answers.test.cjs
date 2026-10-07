require('reflect-metadata');
const test = require('node:test');
const assert = require('node:assert/strict');
const { AnswersService } = require('../dist/generations/answers.service');

function fixture() {
  const turns = []; const calls = [];
  const generation = { id: 'generation', status: 'COMPLETED', structuredOutputJson: { summary: 'QA resume' }, profileSnapshotJson: {}, application: { jobTitle: 'Engineer', company: 'QA', jobDescription: 'Remote role' }, tokenUsage: 0, costEstimate: 0 };
  let fail = false;
  const service = new AnswersService({
    generationTurn: {
      count: async ({ where }) => turns.filter((t) => t.purpose === where.purpose).length,
      findMany: async () => turns.map((t) => ({ ...t })).sort((a, b) => a.sequence - b.sequence),
      createMany: async ({ data }) => { turns.push(...data); },
    },
    resumeGeneration: { findUnique: async () => generation, update: async ({ data }) => Object.assign(generation, data) },
  }, { getAnswerPrompt: async () => 'Prime QA answers; reply yes' }, {
    completeChat: async (messages) => {
      calls.push(messages);
      if (fail) throw new Error('Provider unavailable');
      return { content: messages.at(-1).content.startsWith('Prime') ? 'yes' : `Answer: ${messages.at(-1).content}`, tokenUsage: 10 };
    },
  }, { getAccessibleGeneration: async (id, actor) => { if (actor.id !== 'owner') throw new Error('Access denied'); return generation; } });
  return { service, turns, calls, generation, actor: { id: 'owner', role: 'BIDDER' }, fail: (value) => { fail = value; } };
}

test('answer chat restores older resume context and primes only once', async () => {
  const f = fixture();
  assert.equal((await f.service.list('generation', f.actor)).primed, false);
  await Promise.all([f.service.prime('generation', f.actor), f.service.prime('generation', f.actor)]);
  assert.equal(f.calls.length, 1); assert.equal(f.turns.length, 5);
  assert.equal(f.calls[0][2].content, JSON.stringify(f.generation.structuredOutputJson));
});
test('concurrent questions are stored in order in the same resume conversation', async () => {
  const f = fixture();
  await Promise.all([f.service.ask('generation', f.actor, 'First?'), f.service.ask('generation', f.actor, 'Second?')]);
  const history = await f.service.list('generation', f.actor);
  assert.deepEqual(history.items.map((item) => item.question), ['First?', 'Second?']);
  assert.ok(f.calls.at(-1).some((m) => m.content === 'Answer: First?'));
  assert.equal(new Set(f.turns.map((t) => t.sequence)).size, f.turns.length);
  assert.equal(f.generation.tokenUsage, 30);
});
test('failed answers do not create incomplete exchanges and a retry can succeed', async () => {
  const f = fixture();
  await f.service.prime('generation', f.actor);
  f.fail(true);
  await assert.rejects(f.service.ask('generation', f.actor, 'Retry?'), /Provider unavailable/);
  assert.equal(f.turns.length, 5);
  f.fail(false);
  assert.equal((await f.service.ask('generation', f.actor, 'Retry?')).items.length, 1);
});
test('answer chat rejects inaccessible, unfinished, blank and oversized requests', async () => {
  const f = fixture();
  await assert.rejects(f.service.list('generation', { id: 'other' }), /Access denied/);
  await assert.rejects(f.service.ask('generation', f.actor, ' '), /Enter a question/);
  await assert.rejects(f.service.ask('generation', f.actor, 'a'.repeat(4001)), /too long/);
  f.generation.status = 'GENERATING';
  await assert.rejects(f.service.prime('generation', f.actor), /not ready/);
  assert.equal(f.calls.length, 0);
});
