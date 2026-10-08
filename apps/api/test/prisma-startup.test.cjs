const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ensureScript = path.resolve(__dirname, '../scripts/ensure-prisma-client.cjs');
const schema = 'enum UserRole {\n  MASTER\n  ADMIN\n  BIDDER\n}\n';
const readyClient = `module.exports = {
  PrismaClient: class PrismaClient {},
  UserRole: { MASTER: 'MASTER', ADMIN: 'ADMIN', BIDDER: 'BIDDER' },
  Prisma: { prismaVersion: { client: '6.19.3' } }
};`;

function fixture(t, { generated, withCli = true, fail = false } = {}) {
  const tempRoot = path.resolve(os.tmpdir());
  const root = fs.mkdtempSync(path.join(tempRoot, 'anchor-prisma-startup-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), tempRoot);
    assert.ok(path.basename(root).startsWith('anchor-prisma-startup-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const write = (file, value) => {
    const destination = path.join(root, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, value);
  };
  write('package.json', '{}');
  write('prisma/schema.prisma', schema);
  write('node_modules/@prisma/client/package.json', JSON.stringify({ version: '6.19.3', main: 'default.js' }));
  write('node_modules/@prisma/client/default.js', "module.exports = require('.prisma/client/default');");
  write('node_modules/.prisma/client/default.js', generated ? readyClient : 'module.exports = { PrismaClient: class PrismaClient {} };');
  if (generated) write('node_modules/.prisma/client/schema.prisma', schema);
  if (withCli) {
    write('node_modules/prisma/package.json', '{}');
    write('node_modules/prisma/build/index.js', `
      const fs = require('node:fs');
      const path = require('node:path');
      if (process.argv[2] !== 'generate' || process.argv[3] !== '--schema' || !path.isAbsolute(process.argv[4])) process.exit(2);
      fs.appendFileSync('generation-count.txt', 'generated\\n');
      if (${fail}) process.exit(1);
      fs.writeFileSync('node_modules/.prisma/client/default.js', ${JSON.stringify(readyClient)});
      fs.copyFileSync(process.argv[4], 'node_modules/.prisma/client/schema.prisma');
    `);
  }
  return { root, write };
}

function start(root) {
  // This reproduces the API's ordering: preflight must succeed before importing a controller enum.
  return spawnSync(process.execPath, ['-e', `
    require(${JSON.stringify(ensureScript)}).ensurePrismaClient(process.cwd());
    const { UserRole } = require('@prisma/client');
    require('node:assert/strict').equal(UserRole.ADMIN, 'ADMIN');
    console.log('API_IMPORT_READY');
  `], { cwd: root, encoding: 'utf8', windowsHide: true });
}

test('startup repairs the placeholder client and subsequent starts reuse it', t => {
  const { root } = fixture(t);
  const first = start(root);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /API_IMPORT_READY/);
  const second = start(root);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(fs.readFileSync(path.join(root, 'generation-count.txt'), 'utf8'), 'generated\n');
});

test('startup regenerates a client from an older schema', t => {
  const { root, write } = fixture(t, { generated: true });
  write('node_modules/.prisma/client/schema.prisma', 'enum UserRole { ADMIN }');
  const result = start(root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /different schema/);
  assert.equal(fs.readFileSync(path.join(root, 'node_modules/.prisma/client/schema.prisma'), 'utf8'), schema);
});

test('startup repairs missing enum exports even if the generated schema exists', t => {
  const { root, write } = fixture(t, { generated: true });
  write('node_modules/.prisma/client/default.js', 'module.exports = { PrismaClient: class PrismaClient {} };');
  const result = start(root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /missing the application role enums/);
});

test('startup repairs a generated client from a different installed version', t => {
  const { root, write } = fixture(t, { generated: true });
  write('node_modules/.prisma/client/default.js', readyClient.replace('6.19.3', '6.1.0'));
  const result = start(root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /installed client version/);
});

test('a valid deployment starts without the Prisma CLI and tolerates generated formatting', t => {
  const { root, write } = fixture(t, { generated: true, withCli: false });
  write('node_modules/.prisma/client/schema.prisma', '// Formatted by Prisma\r\nenum UserRole{\r\n    MASTER\r\n    ADMIN\r\n    BIDDER\r\n}\r\n');
  const result = start(root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /API_IMPORT_READY/);
});

test('schema comparison preserves whitespace inside quoted field values', t => {
  const { root, write } = fixture(t, { generated: true });
  const model = '\nmodel Note {\n id String @id\n text String @default("two words")\n}\n';
  write('prisma/schema.prisma', schema + model);
  write('node_modules/.prisma/client/schema.prisma', schema + model.replace('two words', 'two  words'));
  const result = start(root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /different schema/);
});

test('failed generation stops startup before any API modules are imported', t => {
  const { root } = fixture(t, { fail: true });
  const result = start(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Prisma client generation failed/);
  assert.doesNotMatch(result.stdout, /API_IMPORT_READY/);
});

test('a deployment missing both generation and CLI reports the repair command', t => {
  const { root } = fixture(t, { withCli: false });
  const result = start(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Install build dependencies and run pnpm db:generate/);
  assert.doesNotMatch(result.stdout, /API_IMPORT_READY/);
});
