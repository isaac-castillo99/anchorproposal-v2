// Page-load smoke coverage using local assets and isolated API fixtures.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const puppeteer = require('puppeteer');

(async () => {
  const origin = 'http://127.0.0.1:3000';
  const output = path.resolve(__dirname, '../../../tmp/functional-qa');
  fs.mkdirSync(output, { recursive: true });
  const browser = await puppeteer.launch({ headless: true, timeout: 120000, protocolTimeout: 120000, userDataDir: path.join(output, 'chrome-profile') });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewport({ width: 1440, height: 1000 });
    await page.evaluateOnNewDocument(() => localStorage.setItem('accessToken', 'page-qa-token'));
    let role = 'ADMIN';
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.origin === origin && !url.pathname.startsWith('/backend/')) return request.continue();
      const route = url.pathname.replace(/^\/backend/, '');
      const send = (body) => request.respond({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS' }, body: JSON.stringify(body) });
      if (request.method() === 'OPTIONS') return send({});
      if (route === '/auth/me') return send({ id: 'qa-admin', role, firstName: 'QA', lastName: 'User', email: 'qa@example.invalid', canCreateApplications: true, canGenerateResumes: true, canDownloadDocuments: true });
      if (route.startsWith('/dashboard')) return send({ kpis: { total: 0, applied: 0, readyToApply: 0, interviews: 0, offers: 0, warnings: 0 }, trend: [], recentGenerations: [], byAdmin: [], byBidder: [], filterOptions: { admins: [], bidders: [] } });
      if (route === '/templates/preview') return send({ html: '<!doctype html><html><body><p>QA template preview</p></body></html>' });
      if (route.includes('application-options')) return send({ locations: [], sources: [] });
      if (url.port === '3001' || url.pathname.startsWith('/backend/')) return send([]);
      if (url.protocol === 'data:') return request.continue();
      return request.abort();
    });
    const routes = ['/dashboard', '/users', '/profiles', '/profiles/new', '/templates', '/templates/new', '/applications', '/job-pool'];
    for (const route of routes) {
      await page.goto(origin + route, { waitUntil: 'networkidle2', timeout: 60000 });
      await page.waitForFunction(() => document.querySelector('h1')?.textContent.trim().length > 0, { polling: 100, timeout: 30000 });
      assert.equal(new URL(page.url()).pathname, route);
      assert.deepEqual(errors, [], `${route}: browser errors`);
      console.log(`PASS ADMIN ${route}`);
    }
    role = 'MASTER';
    await page.goto(origin + '/dashboard', { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForFunction(() => document.querySelector('h1')?.textContent.trim().length > 0, { polling: 100 });
    assert.deepEqual(errors, []);
    console.log('PASS MASTER dashboard');
    role = 'BIDDER';
    await page.goto(origin + '/dashboard', { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForFunction(() => document.querySelector('h1')?.textContent.trim().length > 0, { polling: 100 });
    assert.deepEqual(errors, []);
    console.log('PASS BIDDER dashboard');
    await page.screenshot({ path: path.join(output, 'bidder-dashboard.png'), fullPage: true });
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
