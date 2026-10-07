require('reflect-metadata');
const test = require('node:test');
const assert = require('node:assert/strict');
const { DocumentsController } = require('../dist/documents/documents.controller');

function fixture({ role = 'BIDDER', id = 'bidder', allowed = true, exists = true, kind = 'RESUME', type = 'PDF', firstName = 'Basil Bruce', lastName = 'Crow' } = {}) {
  let reads = 0;
  const controller = new DocumentsController({
    generationFile: { findUnique: async () => ({ filename: 'old_company_job_v1.pdf', kind, type, storagePath: 'qa/resume.pdf', generation: { application: { bidderId: 'bidder' }, profileSnapshotJson: { firstName, lastName }, structuredOutputJson: { coverLetter: { greeting: 'Dear Hiring Manager,', paragraphs: ['My Java API experience matches your backend engineer role.'], closing: 'Sincerely,' } } } }) },
    user: { findUnique: async ({ where }) => ({ id: where.id, canDownloadDocuments: allowed, managedByAdminId: 'admin' }) },
  }, { fileExists: async () => exists, readFile: async () => { reads++; return Buffer.from('QA PDF'); } });
  const headers = {};
  const response = { setHeader: (key, value) => { headers[key] = value; }, send: (body) => { response.body = body; } };
  return { controller, request: { user: { id, role } }, response, headers, reads: () => reads };
}
for (const actor of [{ role: 'BIDDER', id: 'bidder' }, { role: 'ADMIN', id: 'admin' }, { role: 'MASTER', id: 'master' }]) {
  test(`${actor.role} downloads an authorized document with correct attachment headers`, async () => {
    const f = fixture(actor);
    await f.controller.download('file', f.request, f.response);
    assert.equal(f.headers['Content-Type'], 'application/pdf');
    assert.equal(f.headers['Content-Disposition'], 'attachment; filename="Basil Bruce Crow.pdf"; filename*=UTF-8\'\'Basil%20Bruce%20Crow.pdf');
    assert.equal(f.response.body.toString(), 'QA PDF');
  });
}
for (const kind of ['RESUME', 'COVER_LETTER']) {
  for (const type of ['PDF', 'DOCX']) {
    test(`cached ${kind} ${type} download uses the profile name instead of its old storage filename`, async () => {
      const f = fixture({ kind, type, firstName: 'Zoë', lastName: '李' });
      await f.controller.download('cached-file', f.request, f.response);
      const encoded = f.headers['Content-Disposition'].split("filename*=UTF-8''")[1];
      assert.equal(decodeURIComponent(encoded), `Zoë 李${kind === 'COVER_LETTER' ? '_cover letter' : ''}.${type.toLowerCase()}`);
      assert.equal(f.reads(), 1);
    });
  }
}
for (const actor of [{ role: 'BIDDER', id: 'other' }, { role: 'ADMIN', id: 'other-admin' }, { allowed: false }]) {
  test(`document access denial occurs before disk read: ${JSON.stringify(actor)}`, async () => {
    const f = fixture(actor);
    await assert.rejects(f.controller.download('file', f.request, f.response), /permission|Access denied/);
    assert.equal(f.reads(), 0);
  });
}
test('missing document file returns a clear not-found response', async () => {
  const f = fixture({ exists: false });
  await assert.rejects(f.controller.download('file', f.request, f.response), /not found on disk/);
  assert.equal(f.reads(), 0);
});
