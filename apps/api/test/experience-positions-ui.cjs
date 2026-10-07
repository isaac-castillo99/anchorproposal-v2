// Real website with isolated API fixtures: no provider calls or database writes.
require('reflect-metadata');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer');
const { DeepseekService } = require('../dist/deepseek/deepseek.service');
(async () => {
  const origin = process.env.QA_WEB_URL || 'http://127.0.0.1:3000';
  const output = path.resolve('../../tmp/desktop-qa/experience-ui'); fs.mkdirSync(output, { recursive: true });
  const browser = await puppeteer.launch({ headless: true, pipe: false, timeout: 120000, protocolTimeout: 120000, args: ['--no-sandbox', '--disable-gpu'], userDataDir: path.join(output, 'chrome') });
  const page = await browser.newPage(); page.setDefaultTimeout(60000); await page.setViewport({ width: 1440, height: 1000 });
  const errors = [], starts = [], imports = [], diagnostics = [];
  page.on('console', message => { if (message.type() === 'error') diagnostics.push(message.text()); });
  page.on('requestfailed', request => diagnostics.push(`${request.url()}: ${request.failure()?.errorText}`));
  const promptRow = { id: 'prompt-1', name: 'JD Role Match Prompt', content: 'Keep my original role matching prompt text. {{profileJson}} {{jobDescription}}', experienceTitleMode: 'saved', isInitial: false, isPublished: true, version: 1 };
  let promptWrites = 0; page.on('pageerror', e => errors.push(e.message));
  const user = { id: 'u1', role: 'ADMIN', firstName: 'QA', lastName: 'User', canGenerateResumes: true, canDownloadDocuments: true };
  const app = { id: 'app-1', jobTitle: 'Senior Backend Engineer', company: 'Hiring Co', jobDescription: 'Build Java services.', bidderId: 'u1', profileId: 'p1', status: 'SAVED', createdAt: new Date().toISOString(), profile: { firstName: 'Alex', lastName: 'Example' }, warnings: [], latestGenerationId: 'g1', latestFiles: {} };
  const snapshot = { firstName: 'Alex', lastName: 'Example', profileTitle: 'Engineer', experiences: [{ title: 'Developer', company: 'Original Co', startDate: '2020', responsibilities: ['Built Java services'] }], education: [], certifications: [] };
  const compact = { summary: 'Backend engineer.', skills: [{ Languages: 'Java' }], experiences: [{ role: 'Senior Backend Engineer', bullets: ['Built Java services'] }] };
  const deepseek = new DeepseekService({});
  let generation = { id: 'g1', status: 'COMPLETED', version: 1, experienceTitleMode: 'saved', structuredOutputJson: {} };
  const content = mode => deepseek.parseManualResponse(JSON.stringify({ ...compact, ...(mode === 'saved' ? { contact: { name: 'Alex Example' }, educations: [], certificates: [] } : {}) }), { experienceTitleMode: mode, profileExperiences: snapshot.experiences, profileSnapshot: snapshot, candidateName: 'Alex Example', profileTitle: 'Engineer' });
  generation.structuredOutputJson = content('saved');
  await page.evaluateOnNewDocument(() => localStorage.setItem('accessToken', 'qa-token'));
  await page.setRequestInterception(true);
  page.on('request', request => {
    const url = new URL(request.url()); const route = url.pathname.replace(/^\/backend/, '');
    if (url.origin === origin && !url.pathname.startsWith('/backend/')) return request.continue();
    const send = (body, status = 200) => request.respond({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Content-Type,Authorization,ngrok-skip-browser-warning', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS', 'Access-Control-Allow-Credentials': 'true' }, body: JSON.stringify(body) });
    if (request.method() === 'OPTIONS') return send({});
    if (route === '/auth/me') return send(user);
    if (route === '/settings/my-prompt') return send({ useMasterPrompt: true, assignmentMode: 'profile', effectivePrompt: { id: 'default', content: 'Default fixed-position prompt' } });
    if (route === '/settings/answer-prompt') return send({ prompt: 'Answer questions.' });
    if (route === '/settings/prompt-library') return send([promptRow]);
    if (route === '/settings/prompt-library/prompt-1' && request.method() === 'PATCH') {
      const body = JSON.parse(request.postData()); assert.equal(body.content, promptRow.content); promptWrites++; Object.assign(promptRow, body); return send(promptRow);
    }
    if (route === '/applications') return send([app]);
    if (route === '/applications/app-1') return send(app);
    if (route === '/templates') return send([{ id: 't1', name: 'Classic', isPublished: true, isDefault: true }]);
    if (route === '/applications/app-1/generation-prompt') return send({ usedDefault: false, experienceTitleModes: ['saved', 'tailored'] });
    if (route === '/applications/app-1/generations') {
      if (request.method() === 'GET') return send([generation]);
      const body = JSON.parse(request.postData()); assert.equal(body.experienceTitleMode, undefined); starts.push(promptRow.experienceTitleMode);
      generation = { ...generation, experienceTitleMode: promptRow.experienceTitleMode, structuredOutputJson: content(promptRow.experienceTitleMode) }; return send(generation);
    }
    if (route === '/applications/app-1/manual-generation-prompt') {
      assert.equal(url.searchParams.get('experienceTitleMode'), null);
      const mode = promptRow.experienceTitleMode;
      return send({ prompt: deepseek.resumeSystemContent(mode) + '\n' + JSON.stringify(snapshot), experienceTitleMode: mode, templateId: 't1', contextHash: (mode === 'saved' ? 'a' : 'b').repeat(64), promptName: 'QA prompt' });
    }
    if (route === '/applications/app-1/generations/manual') {
      const body = JSON.parse(request.postData()); imports.push(body);
      try { generation = { ...generation, experienceTitleMode: promptRow.experienceTitleMode, structuredOutputJson: deepseek.parseManualResponse(body.responseJson, { experienceTitleMode: promptRow.experienceTitleMode, profileSnapshot: snapshot, profileExperiences: snapshot.experiences, candidateName: 'Alex Example' }) }; return send(generation); }
      catch (e) { return send({ message: e.message }, 400); }
    }
    if (route === '/generations/g1') return send(generation);
    if (route === '/generations/g1/preview') return send({ html: '<html><body>Resume preview</body></html>', pageSize: 'A4' });
    return send([]);
  });
  const waitText = text => page.waitForFunction(t => document.body.innerText.includes(t), {}, text);
  const click = async text => { const el = await page.waitForFunction(t => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === t && !b.disabled), {}, text); await el.asElement().click(); };
  const assertNoPositionChoice = async () => {
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('select')].some(s => [...s.options].some(o => o.value === 'tailored'))), false);
  };
  const setPromptFlag = async enabled => {
    await page.goto(origin + '/settings', { waitUntil: 'networkidle2', timeout: 120000 });
    await waitText('Profile prompt library');
    await page.waitForFunction(() => [...document.querySelectorAll('span')].some(el => el.textContent === 'JD Role Match Prompt'));
    assert.ok((await page.evaluate(() => document.body.innerText)).includes('Default prompts always use fixed profile positions.'));
    await page.evaluate(() => {
      const title = [...document.querySelectorAll('span')].find(el => el.textContent === 'JD Role Match Prompt');
      const card = title.closest('.rounded-xl'); [...card.querySelectorAll('button')].find(b => b.textContent.trim() === 'Edit').click();
    });
    await page.waitForFunction(() => [...document.querySelectorAll('.rounded-xl')].some(card => card.textContent.includes('JD Role Match Prompt') && card.querySelector('input[type="checkbox"]')));
    await page.evaluate(enabled => {
      const title = [...document.querySelectorAll('span')].find(el => el.textContent === 'JD Role Match Prompt');
      const card = title.closest('.rounded-xl'); const box = card.querySelector('input[type="checkbox"]'); if (box.checked !== enabled) box.click(); card.scrollIntoView({ block: 'center' });
    }, enabled);
    await page.screenshot({ path: path.join(output, enabled ? 'prompt-flag-on.png' : 'prompt-flag-off.png'), fullPage: true });
    const previous = promptWrites; await click('Save'); await page.waitForFunction(() => document.body.innerText.includes('Prompt saved'));
    assert.equal(promptWrites, previous + 1); assert.equal(promptRow.experienceTitleMode, enabled ? 'tailored' : 'saved');
  };
  const fill = value => page.$eval('#manual-json-response', (el, v) => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }, value);
  try {
    await setPromptFlag(true);
    await page.goto(origin + '/applications', { waitUntil: 'networkidle2', timeout: 120000 });
    await page.waitForSelector('button[title="Regenerate resume"]');
    await assertNoPositionChoice(); await page.click('button[title="Regenerate resume"]'); await waitText('Ready to download');
    assert.deepEqual(starts, ['tailored']); assert.equal(new URL(page.url()).pathname, '/applications'); await click('Done');
    await page.click('button[title="Generate manually with another model"]'); await page.waitForSelector('#manual-full-prompt');
    assert.match(await page.$eval('#manual-full-prompt', el => el.value), /"role"/);
    await assertNoPositionChoice();
    await fill(JSON.stringify({ ...compact, experiences: [] })); await click('Save resume'); await waitText('exactly 1 experience');
    await fill(JSON.stringify(compact)); await page.screenshot({ path: path.join(output, 'tailored-manual.png'), fullPage: true });
    await page.setViewport({ width: 390, height: 844 });
    const bounds = await page.$eval('dialog', el => { const r = el.getBoundingClientRect(); return [r.left, r.right, r.top, r.bottom]; });
    assert.ok(bounds[0] >= 0 && bounds[1] <= 390 && bounds[2] >= 0 && bounds[3] <= 844);
    await page.screenshot({ path: path.join(output, 'tailored-manual-mobile.png'), fullPage: true });
    await page.setViewport({ width: 1440, height: 1000 }); await click('Save resume'); await waitText('Ready to download');
    assert.equal(imports.at(-1).experienceTitleMode, undefined); assert.equal(imports.at(-1).contextHash, 'b'.repeat(64));
    assert.equal(generation.structuredOutputJson.experiences[0].company, 'Original Co'); assert.equal(generation.structuredOutputJson.experiences[0].title, 'Senior Backend Engineer');
    await click('Done'); await setPromptFlag(false); await page.goto(origin + '/applications', { waitUntil: 'networkidle2', timeout: 120000 }); await page.waitForSelector('button[title="Regenerate resume"]'); await page.click('button[title="Regenerate resume"]'); await waitText('Ready to download');
    assert.deepEqual(starts, ['tailored', 'saved']); assert.equal(generation.structuredOutputJson.experiences[0].title, 'Developer');
    await page.goto(origin + '/applications/app-1', { waitUntil: 'networkidle2', timeout: 120000 }); await page.waitForSelector('a[href="/applications/app-1/resume"]'); await assertNoPositionChoice();
    await page.goto(origin + '/applications/app-1/resume', { waitUntil: 'networkidle2', timeout: 120000 }); await waitText('Resume Preview'); await assertNoPositionChoice();
    assert.deepEqual(errors, []); fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ passed: true, starts, manualImports: imports.length, checks: ['prompt flag editor preserves text', 'default stays fixed', 'prompt controls automatic and manual generation', 'validation errors', 'compact JSON save', 'mobile modal', 'no per-generation selectors'] }, null, 2));
    console.log('PASS: prompt flag edits preserve text, generation automatically follows the prompt, compact import works, defaults stay fixed, and generation selectors are removed.');
  } catch (error) {
    await page.screenshot({ path: path.join(output, 'failed.png'), fullPage: true }).catch(() => {});
    const text = await page.evaluate(() => document.body.innerText).catch(() => 'Page navigated while collecting failure details.');
    fs.writeFileSync(path.join(output, 'failure.json'), JSON.stringify({ error: error.stack, url: page.url(), errors, diagnostics, text }, null, 2));
    throw error;
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
