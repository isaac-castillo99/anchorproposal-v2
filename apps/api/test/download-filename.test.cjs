const test = require('node:test');
const assert = require('node:assert/strict');
const { documentDownloadFilename: filename, documentAttachmentHeader } = require('../dist/documents/download-filename');

test('download names retain the full profile name, spaces, punctuation and Unicode', () => {
  const profile = { firstName: ' Zoë Anne ', lastName: "O'Brien 李" };
  for (const type of ['PDF', 'DOCX']) {
    assert.equal(filename(profile, {}, 'RESUME', type), `Zoë Anne O'Brien 李.${type.toLowerCase()}`);
    assert.equal(filename(profile, {}, 'COVER_LETTER', type), `Zoë Anne O'Brien 李_cover letter.${type.toLowerCase()}`);
  }
});

test('missing snapshot names use the document contact name or a readable fallback', () => {
  assert.equal(filename(null, { contact: { name: 'Alex Example' } }, 'RESUME', 'PDF'), 'Alex Example.pdf');
  assert.equal(filename({}, null, 'COVER_LETTER', 'DOCX'), 'Applicant_cover letter.docx');
  assert.equal(filename({ firstName: '  ' }, { contact: { name: '  ' } }, 'RESUME', 'PDF'), 'Applicant.pdf');
});

test('profile names cannot introduce paths, header injection or Windows device names', () => {
  assert.equal(filename({ firstName: '../Alex\\Test:\r\n"?' }, {}, 'RESUME', 'PDF'), '_Alex_Test_____.pdf');
  assert.equal(filename({ firstName: 'CON' }, {}, 'RESUME', 'PDF'), '_CON.pdf');
  assert.equal(filename({ firstName: 'NUL.txt' }, {}, 'RESUME', 'DOCX'), '_NUL.txt.docx');
  const long = filename({ firstName: '李'.repeat(100) }, {}, 'COVER_LETTER', 'DOCX');
  assert.ok(Buffer.byteLength(long) < 200);
  assert.ok(long.endsWith('_cover letter.docx'));
});

test('attachment headers provide an ASCII fallback and an exact UTF-8 name', () => {
  const name = "Zoë O'Brien 李_cover letter.pdf";
  const header = documentAttachmentHeader(name);
  assert.match(header, /^attachment; filename="Zo_ O'Brien __cover letter.pdf";/);
  assert.ok(!/[^\x20-\x7e]/.test(header));
  assert.equal(decodeURIComponent(header.split("filename*=UTF-8''")[1]), name);
});
