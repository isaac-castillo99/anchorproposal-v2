// Read-only template catalog + temporary exports; no application records are changed.
require('reflect-metadata');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { ConfigModule } = require('@nestjs/config');
const { PrismaClient } = require('@prisma/client');
const { DeepseekService } = require('../dist/deepseek/deepseek.service');
const { TemplatesService } = require('../dist/templates/templates.service');
const { DocumentRendererService } = require('../dist/documents/document-renderer.service');
const JSZip = require(require.resolve('jszip', { paths: [require.resolve('docx')] }));
const puppeteer = require('puppeteer');
(async () => {
  await ConfigModule.forRoot(); const prisma = new PrismaClient(); let browser;
  const destination = path.resolve('../../tmp/desktop-qa/experience-exports'); await fs.mkdir(destination, { recursive: true });
  try {
    const catalog = await prisma.templateVersion.findMany({ where: { isPublished: true } }); assert.ok(catalog.length);
    const templates = new TemplatesService(prisma); const renderer = new DocumentRendererService(templates, null);
    const source = { firstName: 'Alex', lastName: 'Example', email: 'alex@example.com', profileTitle: 'Software Engineer', experiences: [{ title: 'Software Developer II', company: 'Example Systems', startDate: '2020', endDate: '', location: 'Seattle', responsibilities: ['Built reliable Java APIs'] }], education: [{ degree: 'BSc Computer Science', institution: 'Example University', endDate: '2020' }], certifications: [] };
    const response = { contact: { name: 'Alex Example' }, summary: 'Engineer building reliable backend services.', skills: [{ Languages: 'Java, SQL' }], experiences: [{ role: 'Senior Backend Engineer', company: 'Example Systems', dates: '2020 – Present', bullets: ['Built reliable Java APIs', 'Improved query performance for reporting services.'] }], educations: source.education, certificates: [] };
    const deepseek = new DeepseekService({}); const results = [];
    browser = await puppeteer.launch({ headless: true, pipe: true, timeout: 120000, protocolTimeout: 120000, args: ['--no-sandbox'] });
    for (const mode of ['saved', 'tailored']) {
      const content = deepseek.parseManualResponse(JSON.stringify(response), { experienceTitleMode: mode, profileSnapshot: source, profileExperiences: source.experiences, profileTitle: source.profileTitle, candidateName: 'Alex Example' });
      const expected = mode === 'tailored' ? 'Senior Backend Engineer' : 'Software Developer II';
      for (const [index, template] of catalog.entries()) {
        const html = templates.renderPreviewHtml(content, template.configJson || {});
        assert.ok(html.includes(expected), template.name + ': title missing'); assert.ok(html.includes('Example Systems'), template.name + ': company missing');
        const docx = await renderer.renderDocx(content, template.configJson || {});
        const xml = await (await JSZip.loadAsync(docx)).file('word/document.xml').async('string');
        assert.ok(xml.includes(expected), template.name + ': DOCX title missing'); assert.ok(xml.includes('Example Systems'));
        await fs.writeFile(path.join(destination, `${index}-${mode}.docx`), docx);
        if (index === 0) {
          await fs.writeFile(path.join(destination, `${mode}.pdf`), await renderer.renderPdf(html, template.configJson || {}, browser));
          const page = await browser.newPage(); await page.setViewport({ width: 900, height: 1100 }); await page.setContent(html); await page.screenshot({ path: path.join(destination, `${mode}.png`), fullPage: true }); await page.close();
        }
        results.push({ template: template.name, mode, title: expected });
      }
    }
    await fs.writeFile(path.join(destination, 'results.json'), JSON.stringify(results, null, 2));
    console.log(`PASS: ${catalog.length} published templates in both modes, DOCX content, and saved/tailored PDF exports.`);
  } finally { await browser?.close(); await prisma.$disconnect(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
