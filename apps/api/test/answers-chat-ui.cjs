// Exercise the real web UI with isolated API fixtures. No AI calls or database writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer');

(async () => {
  const origin = 'http://127.0.0.1:3000';
  const artifacts = path.resolve(__dirname, '../../../tmp/answers-qa');
  fs.mkdirSync(artifacts, { recursive: true });
  const browser = await puppeteer.launch({ headless: true, pipe: true, timeout: 120000, protocolTimeout: 60000, userDataDir: path.join(artifacts, 'chrome-profile') });
  let page;
  try {
    page = await browser.newPage();
    page.setDefaultTimeout(30000);
    await page.setViewport({ width: 1440, height: 1050 });
    await page.evaluateOnNewDocument(() => {
      localStorage.setItem('accessToken', 'chat-qa-token');
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (text) => { window.qaCopiedAnswer = text; } } });
    });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    let primed = false;
    let primes = 0;
    let questions = 0;
    let pendingAnswer;
    let failQuestion = false;
    let failLoad = false;
    const items = [];
    const view = () => ({ primed, ack: primed ? 'yes' : null, items });
    const application = {
      id: 'chat-app', jobTitle: 'Senior Backend Engineer', company: 'Example Co', status: 'SAVED', jobDescription: 'Build Java services.',
      createdAt: new Date().toISOString(), warnings: [], notes: [], statusHistory: [],
      profile: { id: 'chat-profile', firstName: 'Alex', lastName: 'Morgan', profileTitle: 'Backend Engineer' },
      bidder: { id: 'chat-user', firstName: 'QA', lastName: 'Admin' },
      latestGenerationId: 'chat-gen', latestFiles: {}, _count: { generations: 2 },
      generations: [{ id: 'chat-gen', version: 2, status: 'COMPLETED', createdAt: new Date().toISOString(), files: [] }, { id: 'older-gen', version: 1, status: 'COMPLETED', createdAt: new Date().toISOString(), files: [] }],
    };
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.origin === origin && !url.pathname.startsWith('/backend/')) return request.continue();
      const route = url.pathname.replace(/^\/backend/, '');
      const send = (data, status = 200) => request.respond({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS' }, body: JSON.stringify(data) });
      if (request.method() === 'OPTIONS') return send({});
      if (route === '/auth/me') return send({ id: 'chat-user', role: 'ADMIN', firstName: 'QA', lastName: 'Admin', canGenerateResumes: true });
      if (route === '/applications') return send([application]);
      if (route === '/applications/chat-app') return send(application);
      if (route === '/applications/options') return send({ locations: [], sources: [] });
      if (route === '/generations/older-gen/answers') return send({ primed: true, ack: 'yes', items: [{ question: 'Earlier question', answer: 'Answer for the earlier resume version.' }] });
      if (route === '/generations/chat-gen/answers/prompt') { primes++; primed = true; return send(view()); }
      if (route === '/generations/chat-gen/answers') {
        if (request.method() === 'GET') {
          if (failLoad) return send({ message: 'Conversation temporarily unavailable' }, 503);
          return send(view());
        }
        questions++;
        const { question } = JSON.parse(request.postData());
        if (failQuestion) { failQuestion = false; return send({ message: 'Answer service temporarily unavailable' }, 503); }
        pendingAnswer = async (answer) => { items.push({ question, answer }); await send(view()); pendingAnswer = undefined; };
        return;
      }
      if (url.port === '3001' || url.pathname.startsWith('/backend/')) return send([]);
      return request.abort();
    });
    const until = (predicate, ...args) => page.waitForFunction(predicate, { polling: 100, timeout: 30000 }, ...args);
    const clickText = async (label) => {
      const button = await until((text) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === text && !b.disabled), label);
      await button.asElement().click();
    };
    const waitAnswers = (count) => until((expected) => document.querySelectorAll('[data-chat-role="assistant"]').length === expected && !document.querySelector('[aria-label="Assistant is thinking"]'), count);
    const textarea = 'textarea[placeholder="Ask a question about this application…"]';
    const submit = async (text) => {
      await page.focus(textarea);
      await page.keyboard.type(text);
      const request = page.waitForRequest((r) => new URL(r.url()).pathname.endsWith('/generations/chat-gen/answers') && r.method() === 'POST');
      await page.keyboard.press('Enter');
      await request;
    };
    await page.goto(`${origin}/applications`, { waitUntil: 'domcontentloaded', timeout: 180000 });
    await page.waitForSelector('button[title="Get answers"]');
    await page.click('button[title="Get answers"]');
    await until(() => document.querySelector('dialog[open] textarea') && !document.querySelector('dialog[open] textarea').disabled);
    assert.equal(await page.$eval('dialog', (el) => el.matches(':modal')), true);
    assert.equal(await page.$eval('[aria-label="Send question"]', (el) => el.disabled), true);
    assert.ok((await page.$eval('[role="log"]', (el) => el.innerText)).includes('Ask your first question'));
    assert.equal(await page.evaluate(() => document.activeElement.tagName), 'TEXTAREA');
    await page.screenshot({ path: path.join(artifacts, 'chat-empty-desktop.png'), fullPage: true });

    await page.keyboard.type('Tell me about your Java experience.');
    await page.keyboard.down('Shift');
    await page.keyboard.press('Enter');
    await page.keyboard.up('Shift');
    await page.keyboard.type('Keep it concise.');
    assert.equal(questions, 0, 'Shift+Enter must not submit');
    const firstRequest = page.waitForRequest((r) => r.method() === 'POST' && new URL(r.url()).pathname.endsWith('/generations/chat-gen/answers'));
    await page.keyboard.press('Enter');
    await firstRequest;
    await until(() => Boolean(document.querySelector('[aria-label="Assistant is thinking"]')));
    assert.equal(primes, 1);
    assert.equal(questions, 1);
    assert.equal(await page.$eval('[aria-label="Send question"]', (el) => el.disabled), true);
    assert.equal(await page.$eval('[aria-label="Close answers chat"]', (el) => el.disabled), true);
    await page.keyboard.press('Escape');
    assert.ok(await page.$('dialog[open]'), 'Escape must not discard an in-flight question');
    const answer1 = 'I build and maintain backend services using Java and Spring Boot. My experience includes designing REST APIs, improving database queries, and working with teams to deliver reliable services.';
    await pendingAnswer(answer1);
    await waitAnswers(1);
    assert.equal(await page.$$eval('[data-chat-role="user"]', (els) => els.length), 1);
    assert.equal(await page.$eval(textarea, (el) => el.value), '');
    await page.click('[aria-label="Copy answer"]');
    assert.equal(await page.evaluate(() => window.qaCopiedAnswer), answer1);

    failQuestion = true;
    await submit('How would you approach this role?');
    await until(() => document.querySelector('form [role="alert"]')?.innerText.includes('Answer service temporarily unavailable'));
    assert.equal(await page.$eval(textarea, (el) => el.value), 'How would you approach this role?');
    assert.equal(await page.$$eval('[data-chat-role="user"]', (els) => els.length), 1, 'failed question must not duplicate saved history');
    const retryRequest = page.waitForRequest((r) => r.method() === 'POST' && new URL(r.url()).pathname.endsWith('/generations/chat-gen/answers'));
    await page.click('[aria-label="Send question"]');
    await retryRequest;
    await pendingAnswer('I would start by understanding the product and the team’s priorities, then review the existing services and agree on a focused first delivery. I would bring the same attention to API design, testing, and reliability that I use in my current work.');
    await waitAnswers(2);
    assert.equal(primes, 1, 'follow-ups must continue the existing conversation');
    await page.screenshot({ path: path.join(artifacts, 'chat-desktop.png'), fullPage: true });
    assert.equal(page.url(), `${origin}/applications`);
    await page.keyboard.press('Escape');
    await until(() => !document.querySelector('dialog[open]'));
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('title')), 'Get answers');

    await page.click('button[title="Get answers"]');
    await waitAnswers(2);
    await page.setViewport({ width: 390, height: 844 });
    await until(() => { const log = document.querySelector('[role="log"]'); return log.scrollHeight - log.scrollTop - log.clientHeight < 32; });
    await page.screenshot({ path: path.join(artifacts, 'chat-mobile.png'), fullPage: true });
    const layout = await page.evaluate(() => {
      const dialog = document.querySelector('dialog').getBoundingClientRect();
      const composer = document.querySelector('dialog form').getBoundingClientRect();
      return { fits: dialog.left >= 0 && dialog.right <= innerWidth && dialog.top >= 0 && dialog.bottom <= innerHeight, composerVisible: composer.bottom <= dialog.bottom && composer.top > dialog.top };
    });
    assert.ok(layout.fits && layout.composerVisible, JSON.stringify(layout));
    await page.focus(textarea);
    await page.keyboard.down('Shift');
    await page.keyboard.press('Tab');
    await page.keyboard.up('Shift');
    assert.equal(await page.evaluate(() => document.querySelector('dialog').contains(document.activeElement)), true);
    await page.click('[aria-label="Close answers chat"]');

    failLoad = true;
    await page.click('button[title="Get answers"]');
    await until(() => document.querySelector('[role="log"]')?.innerText.includes('Conversation temporarily unavailable'));
    assert.equal(await page.$eval('[aria-label="Send question"]', (el) => el.disabled), true);
    failLoad = false;
    await clickText('Reload conversation');
    await waitAnswers(2);
    await page.click('[aria-label="Close answers chat"]');
    await page.setViewport({ width: 1440, height: 1050 });

    await page.goto(`${origin}/applications/chat-app`, { waitUntil: 'domcontentloaded', timeout: 180000 });
    await clickText('Answers');
    await waitAnswers(2);
    await page.select('select:has(option[value="older-gen"])', 'older-gen');
    await until(() => document.querySelector('[role="log"]')?.innerText.includes('Answer for the earlier resume version.'));
    assert.ok(!(await page.$eval('[role="log"]', (el) => el.innerText)).includes(answer1));
    assert.deepEqual(errors, []);
    console.log('PASS: chat modal and detail panel, saved history, one-time priming, multiline/send shortcuts, pending state, duplicate prevention, failure recovery, copy, reopen, mobile layout, keyboard focus, and resume-version isolation.');
  } catch (error) {
    if (page && !page.isClosed()) {
      console.error('Page:', await page.evaluate(() => document.body.innerText.slice(-2000)));
      await page.screenshot({ path: path.join(artifacts, 'failure.png'), fullPage: true });
    }
    throw error;
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
