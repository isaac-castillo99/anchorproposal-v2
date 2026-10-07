import 'reflect-metadata';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as assert from 'assert';
import puppeteer from 'puppeteer';
import { TEMPLATE_CATALOG } from './prisma/template-catalog';
import { TemplatesService } from './src/templates/templates.service';
import { DocumentRendererService } from './src/documents/document-renderer.service';

async function main() {
  const output = path.resolve('../../tmp/template-qa');
  await fs.mkdir(output, { recursive: true });
  const templates = new TemplatesService(null as never);
  const renderer = new DocumentRendererService(templates, null as never);
  const cache = path.join(require('os').homedir(), '.cache/puppeteer/chrome');
  const builds = process.platform === 'win32' ? (await fs.readdir(cache)).sort() : [];
  const executablePath = process.env.QA_CHROME_PATH || (process.platform === 'win32'
    ? path.join(cache, builds[builds.length - 1], 'chrome-win64/chrome.exe')
    : puppeteer.executablePath());
  const browser = await puppeteer.launch({ headless: true, timeout: 120_000, executablePath, userDataDir: path.join(output, 'chrome-profile'), args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  page.setDefaultTimeout(120_000);
  const results: object[] = [];
  try {
    for (const template of TEMPLATE_CATALOG) {
      for (const variant of ['short', 'long']) {
        const sample = templates.getSamplePreviewContent();
        if (variant === 'long') {
          sample.summary = sample.summary.repeat(4);
          sample.experiences = Array.from({ length: 6 }, (_, index) => ({
            ...sample.experiences[index % 2],
            title: `Senior Backend Platform Engineer ${index + 1}`,
            bullets: Array.from({ length: 6 }, (_, i) => `Achievement ${index + 1}.${i + 1}: Designed distributed systems and delivered reliable services across engineering teams. Improved performance and maintained production applications with measurable results.`),
          }));
          sample.contact.linkedin = 'linkedin.com/in/a-very-long-candidate-profile-address-for-testing-layout';
        }
        const config = { ...template.configJson, layout: { ...(template.configJson.layout as object), pageSize: variant === 'long' ? 'A4' : 'LETTER' } };
        const html = templates.renderPreviewHtml(sample, config);
        assert.ok(!html.includes('[object Object]'));
        await page.setContent(html);
        const layout = await page.evaluate(() => {
          const sheet = document.querySelector('.sheet')!.getBoundingClientRect();
          const paper = document.querySelector('.page')!.getBoundingClientRect();
          const overflow = [...document.querySelectorAll('.sheet *')].filter((node) => {
            const r = node.getBoundingClientRect();
            return r.width && (r.left < sheet.left - 1 || r.right > sheet.right + 1);
          }).map((node) => node.className || node.tagName);
          return { left: sheet.left - paper.left, right: paper.right - sheet.right, overflow };
        });
        assert.ok(layout.left >= 28 && layout.right >= 28, `${template.name}: preview margins`);
        assert.deepStrictEqual(layout.overflow, [], `${template.name}: horizontal overflow`);
        const basename = `${template.preset}-${variant}`;
        await page.setViewport({ width: 900, height: 1200 });
        const refreshSide = process.argv.includes('--refresh-side') && (template.configJson.pdf as { headerAccent?: string })?.headerAccent === 'side';
        const resume = process.argv.includes('--resume') && !refreshSide && await fs.access(path.join(output, `${basename}.pdf`)).then(() => true, () => false);
        if (!resume) {
          await page.screenshot({ path: path.join(output, `${basename}-preview.png`), fullPage: true });
          await fs.writeFile(path.join(output, `${basename}.pdf`), await renderer.renderPdf(html, config, browser));
        }
        await fs.writeFile(path.join(output, `${basename}.docx`), await renderer.renderDocx(sample, config));
        results.push({ template: template.name, variant, ...layout });
        console.log(`PASS ${basename}`);
      }
    }
    const noDividers = templates.renderPreviewHtml(templates.getSamplePreviewContent(), { styles: { showDividers: false, sectionHeadingStyle: 'plain' } });
    assert.ok(!noDividers.includes('<div class="full-rule'));
    await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
  } finally { await browser.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
