// Local UI regression checks with all API calls intercepted (no provider calls or real data writes).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer');

(async () => {
  const origin = 'http://127.0.0.1:3000';
  const artifacts = path.resolve(__dirname, '../../../tmp/settings-qa');
  fs.mkdirSync(artifacts, { recursive: true });
  const browser = await puppeteer.launch({ headless: true, pipe: true, timeout: 120000, protocolTimeout: 120000, userDataDir: path.join(artifacts, 'chrome-profile') });
  let page;
  try {
    page = await browser.newPage();
    page.setDefaultTimeout(30000);
    await page.setViewport({ width: 1440, height: 1100 });
    await page.evaluateOnNewDocument(() => localStorage.setItem('accessToken', 'qa-token'));
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    let actor = 'a';
    const state = { a: { mode: 'profile', custom: null }, b: { mode: 'profile', custom: null } };
    let starts = 0;
    let writes = 0;
    let emptyRestoreResponse = false;
    const shared = { id: 'shared', name: 'Default prompt', content: 'Shared default resume instructions.\nUse {{profileJson}} and {{jobDescription}}.', version: 1, isPublished: true };
    const myPrompt = () => ({ role: 'ADMIN', useMasterPrompt: !state[actor].custom, assignmentMode: state[actor].mode, masterPrompt: shared, myPrompts: [], assignedPrompts: [], profilePrompts: [], effectivePrompt: state[actor].custom || shared });
    const sentences = [
      'This is a hybrid role with two office days per week.',
      'You must work onsite during the first month.',
      'No security clearance is required for this role.',
      'Duplicate application: this profile already has an application to Example Co, including “Backend Engineer” (applied).',
    ];
    const application = () => ({ id: 'app-1', jobTitle: 'Java Engineer', company: 'Example Co', status: 'SAVED', createdAt: new Date().toISOString(), profile: { id: 'profile-1', firstName: 'QA', lastName: 'Candidate', profileTitle: 'Engineer' }, bidder: { id: actor, firstName: 'Admin', lastName: actor }, warnings: sentences.map((text, index) => ({ id: `w${index}`, category: ['REMOTE_CONFLICT', 'REMOTE_CONFLICT', 'CLEARANCE', 'DUPLICATE'][index], matchedText: text, severity: 'CONFIRM', behavior: 'CONFIRM' })), _count: { generations: 1 }, latestGenerationId: 'gen-1', latestFiles: {} });
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.origin === origin && !url.pathname.startsWith('/backend/')) return request.continue();
      const route = url.pathname.replace(/^\/backend/, '');
      const send = (data) => request.respond({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS' }, body: JSON.stringify(data) });
      if (request.method() === 'OPTIONS') return send({});
      if (route === '/auth/me') return send({ id: actor, role: 'ADMIN', firstName: 'Admin', lastName: actor, email: `${actor}@qa.invalid`, canGenerateResumes: true });
      if (route === '/settings/my-prompt') {
        if (request.method() === 'PATCH') {
          const data = JSON.parse(request.postData());
          if (data.resetToDefault && emptyRestoreResponse) {
            return send({ ...myPrompt(), useMasterPrompt: true, effectivePrompt: null });
          }
          assert.ok(!('selectedPromptId' in data) && !('useMasterPrompt' in data));
          state[actor].mode = data.mode;
          if (data.resetToDefault) state[actor].custom = null;
          else if (data.content) state[actor].custom = { ...shared, id: `private-${actor}`, content: data.content };
          writes++;
        }
        return send(myPrompt());
      }
      if (route === '/settings/answer-prompt') return send({ prompt: 'Answer questions using the resume.' });
      if (route === '/settings/prompt-library') return send([{ ...shared, id: 'profile-prompt', name: 'Profile prompt' }]);
      if (route === '/applications') return send([application()]);
      if (route === '/applications/app-1') return send(application());
      if (route === '/applications/app-1/generation-prompt') return send({ usedDefault: false, promptName: 'Default', profileName: 'QA Candidate' });
      if (route === '/templates') return send([{ id: 'template-1', isPublished: true, isDefault: true }]);
      if (route === '/applications/app-1/generations') { starts++; return send({ id: 'gen-1', status: 'QUEUED' }); }
      if (route === '/generations/gen-1') return send({ id: 'gen-1', status: 'COMPLETED' });
      if (url.port === '3001' || url.pathname.startsWith('/backend/')) return send([]);
      return request.abort();
    });
    // Timer polling also works when headless Chrome throttles animation frames.
    const waitUntil = (predicate, ...args) => page.waitForFunction(predicate, { polling: 100, timeout: 30000 }, ...args);
    const clickText = async (text) => {
      const handle = await waitUntil((label) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === label && !b.disabled), text);
      await handle.asElement().click();
    };
    const waitContent = (text) => waitUntil((value) => document.querySelector('#default-resume-prompt')?.value === value, text);
    const setPrompt = async (text) => {
      await page.focus('#default-resume-prompt');
      await page.keyboard.down('Control');
      await page.keyboard.press('KeyA');
      await page.keyboard.up('Control');
      await page.keyboard.type(text);
    };
    await page.goto(`${origin}/settings`, { waitUntil: 'domcontentloaded', timeout: 180000 });
    await waitContent(shared.content);
    console.log('Settings loaded with the shared default.');
    const body = await page.evaluate(() => document.body.innerText);
    assert.ok(!body.includes('How prompts are assigned'));
    assert.ok(!body.includes('Prompt I use when generating'));
    assert.equal(await page.$$eval('input[name="generation-prompt-mode"]', (els) => els.length), 2);
    await page.click('input[name="generation-prompt-mode"]');
    await setPrompt('Private default for Admin A');
    await clickText('Save resume prompt');
    await waitUntil(() => [...document.querySelectorAll('button')].some((b) => b.textContent === 'Save resume prompt' && b.disabled));
    assert.equal(writes, 1);
    console.log('Private default saved.');
    await page.reload({ waitUntil: 'networkidle2' });
    await waitContent('Private default for Admin A');
    assert.equal(await page.$eval('input[name="generation-prompt-mode"]', (el) => el.checked), true);
    await page.screenshot({ path: path.join(artifacts, 'settings-desktop.png'), fullPage: true });
    actor = 'b';
    await page.reload({ waitUntil: 'networkidle2' });
    await waitContent(shared.content);
    actor = 'a';
    await page.reload({ waitUntil: 'networkidle2' });
    await waitContent('Private default for Admin A');
    emptyRestoreResponse = true;
    await clickText('Restore shared default');
    await waitUntil(() => document.body.innerText.includes('The default prompt could not be loaded.'));
    await waitContent('Private default for Admin A');
    emptyRestoreResponse = false;
    await clickText('Restore shared default');
    await waitContent(shared.content);
    console.log('Empty restore response preserved the editor; successful restore filled it.');
    await page.setViewport({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(artifacts, 'settings-mobile.png'), fullPage: true });
    assert.ok(await page.$eval('#default-resume-prompt', (el) => el.getBoundingClientRect().right <= innerWidth));
    await page.setViewport({ width: 1440, height: 1100 });
    await page.goto(`${origin}/applications`, { waitUntil: 'networkidle2', timeout: 120000 });
    await page.waitForSelector('button[title="Regenerate resume"]');
    await page.click('button[title="Regenerate resume"]');
    await waitUntil(() => document.body.innerText.includes('Application warnings'));
    const warningText = await page.$eval('[role="dialog"]', (el) => el.innerText);
    for (const text of sentences) assert.ok(warningText.includes(text));
    assert.equal(starts, 0);
    await page.screenshot({ path: path.join(artifacts, 'warnings-desktop.png'), fullPage: true });
    await clickText('Cancel');
    await waitUntil(() => !document.querySelector('[role="dialog"]'));
    assert.equal(starts, 0);
    await page.click('button[title="Regenerate resume"]');
    await clickText('Continue');
    await waitUntil(() => document.body.innerText.includes('Ready to download'));
    assert.equal(starts, 1);
    assert.equal(page.url(), `${origin}/applications`);
    assert.deepEqual(errors, []);
    console.log('PASS: simplified Settings, editable private default, two-account display isolation, persisted mode/reset, mobile layout, full warning sentences, Cancel/Continue without navigation.');
  } catch (error) {
    if (page && !page.isClosed()) {
      console.error('Browser content:', await page.evaluate(() => document.body.innerText.slice(0, 1200)));
      await page.screenshot({ path: path.join(artifacts, 'failure.png'), fullPage: true });
    }
    throw error;
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
