const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const builderRequire = createRequire(require.resolve('electron-builder'));
const asar = createRequire(builderRequire.resolve('app-builder-lib'))('@electron/asar');
const root = path.resolve(__dirname, '..');
const hash = value => createHash('sha256').update(value).digest('hex');

(async () => {
  const archive = path.join(root, 'release/build/win-unpacked/resources/app.asar');
  const entries = asar.listPackage(archive).map(name => name.replaceAll('\\', '/').replace(/^\//, ''));
  assert.ok(entries.length > 20);
  for (const name of entries) {
    assert.match(name, /^(main|dist|assets)(\/|$)|^package\.json$/);
    assert.ok(!/(^|\/)(node_modules|\.env[^/]*|session\.json|smoke\.cjs|test)(\/|$)/.test(name), `Unexpected packaged file: ${name}`);
  }
  const manifest = JSON.parse(asar.extractFile(archive, 'package.json'));
  assert.equal(manifest.version, require('../package.json').version);
  const stagedManifest = JSON.parse(await fs.readFile(path.join(root, 'build-app/package.json'), 'utf8'));
  assert.equal(manifest.apiServer, stagedManifest.apiServer, 'Packaged API server differs from the staged build.');
  assert.equal(manifest.apiServer, require('../main/security.cjs').DESKTOP_API_SERVER, 'Packaged API server must use the fixed production address.');
  for (const name of ['main/index.cjs', 'main/security.cjs', 'main/preload.cjs', 'main/session.cjs', 'main/generation.cjs', 'dist/styles.css', 'dist/index.html']) {
    assert.equal(hash(asar.extractFile(archive, name)), hash(await fs.readFile(path.join(root, 'build-app', name))), `Stale packaged file: ${name}`);
  }
  const artifacts = [];
  for (const name of ['AnchorProposal.exe', 'AnchorProposal-Setup.exe']) {
    const relative = `release/v${manifest.version}/${name}`;
    const file = path.join(root, relative); const content = await fs.readFile(file);
    assert.equal(content.subarray(0, 2).toString(), 'MZ');
    artifacts.push({ file, bytes: content.length, sha256: hash(content) });
  }
  const result = { version: manifest.version, apiServer: manifest.apiServer, packagedEntries: entries.length, verified: true, artifacts };
  await fs.writeFile(path.join(root, 'release/verification.json'), JSON.stringify(result, null, 2));
  await fs.writeFile(path.join(root, `release/v${manifest.version}/verification.json`), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
