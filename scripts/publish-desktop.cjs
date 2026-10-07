// Stages the Windows download for the API. Upload this directory to the hosted server.
const fs = require('node:fs/promises');
const { createReadStream, constants } = require('node:fs');
const { createHash, randomUUID } = require('node:crypto');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
async function stage(source, directory, metadata, kind) {
  const temporary = path.join(directory, `${randomUUID()}.upload`);
  await fs.copyFile(source, temporary, constants.COPYFILE_EXCL);
  try {
    const handle = await fs.open(temporary, 'r');
    try {
      const header = Buffer.alloc(2); await handle.read(header, 0, 2, 0);
      if (header.toString() !== 'MZ') throw new Error('The release must be a Windows executable.');
    } finally { await handle.close(); }
    const hash = await sha256(temporary);
    const bytes = (await fs.stat(temporary)).size;
    const fileName = `AnchorProposal-${kind === 'setup' ? 'Setup-' : ''}${metadata.version}-${hash.slice(0, 12)}.exe`;
    const artifact = path.join(directory, fileName);
    try { await fs.copyFile(temporary, artifact, constants.COPYFILE_EXCL); }
    catch (error) {
      if (error.code !== 'EEXIST' || await sha256(artifact) !== hash) throw error;
    }
    return { version: metadata.version, fileName, bytes, sha256: hash,
      publishedAt: new Date().toISOString(), apiBaseUrl: metadata.apiServer || '' };
  } finally {
    await fs.unlink(temporary).catch(() => {});
  }
}
async function publish(directory = path.join(root, 'apps/api/storage/desktop')) {
  const source = path.join(root, 'apps/desktop/release/standalone/AnchorProposal.exe');
  const metadata = JSON.parse(await fs.readFile(path.join(root, 'apps/desktop/build-app/package.json'), 'utf8'));
  if (!/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(metadata.version)) throw new Error('Invalid desktop release version.');
  directory = path.resolve(directory);
  await fs.mkdir(directory, { recursive: true });
  const portable = await stage(source, directory, metadata, 'portable');
  const setupPath = path.join(root, 'apps/desktop/release/setup/AnchorProposal-Setup.exe');
  const setupExists = await fs.stat(setupPath).then(file => file.isFile()).catch(error => {
    if (error.code === 'ENOENT') return false;
    throw error;
  });
  const setup = setupExists ? await stage(setupPath, directory, metadata, 'setup') : null;
  const release = { ...portable, setup };
  // Publish only after every artifact is complete. Old portable-only manifests remain supported.
  const manifestTemp = path.join(directory, `${randomUUID()}.json.tmp`);
  try {
    await fs.writeFile(manifestTemp, JSON.stringify(release, null, 2));
    await fs.rename(manifestTemp, path.join(directory, 'release.json'));
  } finally { await fs.unlink(manifestTemp).catch(() => {}); }
  console.log(`Windows downloads staged: ${directory}\nPortable: ${portable.bytes} bytes\nSetup: ${setup ? `${setup.bytes} bytes` : 'not built'}`);
  return release;
}
if (require.main === module) publish(process.argv[2]).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { publish };
