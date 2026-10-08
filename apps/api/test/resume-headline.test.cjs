require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { TemplatesService } = require('../dist/templates/templates.service');
const { DocumentRendererService } = require('../dist/documents/document-renderer.service');
const JSZip = require(require.resolve('jszip', { paths: [require.resolve('docx')] }));

const content = () => ({
  contact: { name: 'Alex Example', title: 'Senior AI Engineer' },
  summary: 'Experienced engineer building backend services.',
  skills: [{ Languages: 'TypeScript' }],
  experiences: [{ title: 'Senior Software Engineer', company: 'Example Systems', dates: '2021 – Present', bullets: ['Built backend services.'] }],
  educations: [], certificates: [],
});

test('HTML/PDF preview repairs a legacy headline to match the most recent role without changing history', () => {
  const source = content();
  const html = new TemplatesService({}).renderPreviewHtml(source, {});
  assert.equal((html.match(/Senior Software Engineer/g) || []).length, 2);
  assert.ok(!html.includes('Senior AI Engineer'));
  assert.equal(source.contact.title, 'Senior AI Engineer');
  assert.equal(source.experiences[0].title, 'Senior Software Engineer');
});

test('Word export uses the same headline as the newest experience', async () => {
  const templates = new TemplatesService({});
  const buffer = await new DocumentRendererService(templates, null).renderDocx(content(), {});
  const xml = await (await JSZip.loadAsync(buffer)).file('word/document.xml').async('string');
  assert.equal((xml.match(/Senior Software Engineer/g) || []).length, 2);
  assert.ok(!xml.includes('Senior AI Engineer'));
});

test('resumes without work history retain their saved headline', () => {
  const source = { ...content(), experiences: [] };
  assert.ok(new TemplatesService({}).renderPreviewHtml(source, {}).includes('Senior AI Engineer'));
});
