const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/lib/download-filename.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const context = { exports: {} };
vm.runInNewContext(code, context);
const { downloadFilename } = context.exports;
const response = header => new Response(null, { headers: header ? { 'Content-Disposition': header } : {} });

test('server UTF-8 name overrides legacy browser metadata', () => {
  const name = 'Zoë 李_cover letter.docx';
  const header = `attachment; filename="Zo_ __cover letter.docx"; filename*=UTF-8''${encodeURIComponent(name)}`;
  assert.equal(downloadFilename(response(header), 'old_company_v2.docx'), name);
});

test('plain header and missing or malformed headers have usable fallbacks', () => {
  assert.equal(downloadFilename(response('attachment; filename="Basil Bruce Crow.pdf"'), 'old.pdf'), 'Basil Bruce Crow.pdf');
  assert.equal(downloadFilename(response('attachment; filename="Alex.pdf"; filename*=UTF-8\'\'%broken'), 'old.pdf'), 'Alex.pdf');
  assert.equal(downloadFilename(response(null), 'Alex.pdf'), 'Alex.pdf');
});
