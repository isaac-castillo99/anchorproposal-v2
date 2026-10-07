// Browser regression test against the local web server. API requests are intercepted;
// it never generates with a provider or changes the application's database.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer');

(async () => {
  const origin = process.env.QA_WEB_URL || 'http://127.0.0.1:3000';
  const artifacts = path.resolve(__dirname, '../../../tmp/generation-qa');
  fs.mkdirSync(artifacts, { recursive: true });
  const browser = await puppeteer.launch({ headless: true, pipe: true, timeout: 120000, protocolTimeout: 120000, args: ['--no-sandbox', '--disable-dev-shm-usage'], userDataDir: path.join(artifacts, 'chrome-profile') });
  let page;
  try {
    page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1000 });
    page.setDefaultTimeout(60000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.evaluateOnNewDocument(() => {
      localStorage.setItem('accessToken', 'qa-token');
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (value) => { window.qaCopiedPrompt = value; } } });
    });
    let currentGeneration = 'gen-old';
    let starts = 0;
    let imports = 0;
    let failPreview = false;
    let failGeneration = false;
    let savedKey;
    const resume = { contact: { name: 'Alex Example' }, summary: 'Backend engineer.', skills: [], experiences: [], educations: [], certificates: [] };
    const fullPrompt = 'SYSTEM INSTRUCTIONS\nYou are a professional resume writer. Reply with valid json only.\n\nRESUME REQUEST\nAlex Example, Backend Engineer. Senior Java Developer at Hiring Co. Build reliable services.';
    const application = () => ({
      id: 'app-1', jobTitle: 'Senior Java Developer', company: 'Hiring Co', status: 'SAVED',
      createdAt: new Date().toISOString(), profile: { id: 'profile-1', firstName: 'Alex', lastName: 'Example', profileTitle: 'Backend Engineer' },
      bidder: { firstName: 'Test', lastName: 'User' }, warnings: [], _count: { generations: 1 },
      latestGenerationId: currentGeneration, latestFiles: {},
    });
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.origin === origin && !url.pathname.startsWith('/backend/')) return request.continue();
      const route = url.pathname.replace(/^\/backend/, '');
      const send = (body, status = 200) => request.respond({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Content-Type,Authorization,ngrok-skip-browser-warning', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS', 'Access-Control-Allow-Credentials': 'true' }, body: JSON.stringify(body) });
      if (request.method() === 'OPTIONS') return send({});
      if (route === '/auth/me') return send({ id: 'user-1', role: 'BIDDER', firstName: 'Test', lastName: 'User', email: 'test@example.com', canGenerateResumes: true, canDownloadDocuments: true });
      if (route === '/applications' && request.method() === 'GET') return send([application()]);
      if (route === '/applications/app-1') return send(application());
      if (route === '/applications/app-1/generation-prompt') return failPreview ? send({ message: 'Prompt lookup failed' }, 503) : send({ usedDefault: false, promptName: 'Assigned prompt', profileName: 'Alex Example' });
      if (route === '/templates') return send([{ id: 'template-1', name: 'Classic', isPublished: true, isDefault: true }]);
      if (route === '/applications/app-1/generations') { starts++; return send({ id: 'gen-auto', status: 'QUEUED' }); }
      if (route === '/generations/gen-auto') {
        if (failGeneration) return send({ status: 'FAILED', errorMessage: 'Provider unavailable' });
        currentGeneration = 'gen-auto'; return send({ status: 'COMPLETED' });
      }
      if (route === '/applications/app-1/manual-generation-prompt') return send({ prompt: fullPrompt, contextHash: 'a'.repeat(64), templateId: 'template-1', usedDefault: false, promptName: 'Assigned prompt', profileName: 'Alex Example' });
      if (route === '/applications/app-1/generations/manual') {
        imports++;
        const body = JSON.parse(request.postData());
        assert.equal(body.contextHash, 'a'.repeat(64));
        assert.equal(body.templateId, 'template-1');
        if (savedKey) assert.equal(body.idempotencyKey, savedKey);
        savedKey = body.idempotencyKey;
        try { JSON.parse(body.responseJson); } catch { return send({ message: 'Invalid JSON. Paste the complete JSON response.' }, 400); }
        currentGeneration = 'gen-manual'; return send({ id: currentGeneration, status: 'COMPLETED' });
      }
      // All other API reads receive empty fixtures; only local Next assets may reach a server.
      if (url.port === '3001' || url.pathname.startsWith('/backend/') || route.startsWith('/profiles') || route.startsWith('/users/')) return send([]);
      if (url.origin === origin || url.protocol === 'data:') return request.continue();
      return request.abort();
    });
    const clickText = async (text) => {
      const button = await page.waitForFunction((label) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === label && !b.disabled), { polling: 100, timeout: 60000 }, text);
      await button.asElement().click();
    };
    const waitText = (text) => page.waitForFunction((value) => document.body.innerText.includes(value), { polling: 100, timeout: 60000 }, text);
    const setResponse = async (text) => {
      await page.$eval('#manual-json-response', (el, value) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
        setter.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true }));
      }, text);
    };
    await page.goto(`${origin}/applications?tab=mine`, { waitUntil: 'networkidle2', timeout: 120000 });
    await page.waitForSelector('[title="Regenerate resume"]');
    assert.equal(await page.$eval('[title="Regenerate resume"]', (el) => el.tagName), 'BUTTON', 'The web server is serving an old build with a navigation link.');
    const startingUrl = page.url();
    const search = await page.$('input[placeholder*="Search"]');
    if (search) await search.type('Java');
    await page.click('button[title="Regenerate resume"]');
    await waitText('Ready to download');
    assert.equal(page.url(), startingUrl, 'automatic regeneration navigated');
    assert.equal(starts, 1);
    if (search) assert.equal(await search.evaluate((el) => el.value), 'Java');
    await clickText('Done');
    await page.click('button[title="Generate manually with another model"]');
    await page.waitForSelector('#manual-full-prompt');
    assert.equal(await page.$eval('#manual-full-prompt', (el) => el.value), fullPrompt);
    assert.equal(await page.$eval('dialog', (el) => el.open), true);
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('dialog button')].find((b) => b.textContent.trim() === 'Save resume').disabled), true);
    await clickText('Copy full prompt');
    assert.equal(await page.evaluate(() => window.qaCopiedPrompt), fullPrompt);
    await page.screenshot({ path: path.join(artifacts, 'manual-generation-desktop.png'), fullPage: true });
    await page.setViewport({ width: 390, height: 844 });
    const bounds = await page.$eval('dialog', (el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; });
    assert.ok(bounds.left >= 0 && bounds.right <= 390 && bounds.top >= 0 && bounds.bottom <= 844, JSON.stringify(bounds));
    await page.screenshot({ path: path.join(artifacts, 'manual-generation-mobile.png'), fullPage: true });
    await page.setViewport({ width: 1440, height: 1000 });
    await setResponse('not valid JSON');
    await clickText('Save resume');
    await waitText('Invalid JSON.');
    assert.equal(await page.$eval('#manual-json-response', (el) => el.value), 'not valid JSON');
    await setResponse(JSON.stringify(resume));
    await clickText('Save resume');
    await waitText('Ready to download');
    assert.equal(page.url(), startingUrl, 'manual import navigated');
    assert.equal(imports, 2);
    assert.equal(starts, 1, 'manual mode started automatic generation');
    await clickText('Done');
    await page.click('button[title="Generate manually with another model"]');
    await page.waitForSelector('#manual-full-prompt');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('dialog'), { polling: 100 });
    failPreview = true;
    await page.click('button[title="Regenerate resume"]');
    await waitText('Prompt lookup failed');
    await page.waitForFunction(() => ![...document.querySelectorAll('button[title="Regenerate resume"]')].some((b) => b.disabled), { polling: 100 });
    assert.equal(starts, 1, 'preview failure must not start a generation');
    failPreview = false; failGeneration = true;
    await page.click('button[title="Regenerate resume"]');
    await waitText('Provider unavailable');
    await page.waitForFunction(() => ![...document.querySelectorAll('button[title="Regenerate resume"]')].some((b) => b.disabled), { polling: 100 });
    assert.equal(page.url(), startingUrl);
    assert.deepEqual(errors, []);
    console.log('PASS: automatic regeneration stays in place; manual prompt/import, validation recovery, mobile layout, Escape, prompt/provider errors.');
    console.log(`Screenshots: ${artifacts}`);
  } catch (error) {
    if (page && !page.isClosed()) {
      console.error('Browser location:', page.url());
      console.error('Browser content:', await page.evaluate(() => document.body.innerText.slice(0, 2000)));
      await page.screenshot({ path: path.join(artifacts, 'failure.png'), fullPage: true });
    }
    throw error;
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
