const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const releaseDirectory = path.join(root, 'release', `v${require('../package.json').version}`);
function run(script, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { cwd: root, stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Packaging step failed (${code}).`)));
  });
}
function portable() {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'package-portable.ps1'), '-DestinationDirectory', releaseDirectory], { cwd: root, stdio: 'inherit', windowsHide: true });
    child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Portable packaging failed (${code}).`)));
  });
}
(async () => {
  await run(path.join(__dirname, 'build.cjs'));
  await run(require.resolve('electron-builder/cli.js'), ['--win', 'nsis', '--x64']);
  // Each download is one executable. Intermediate runtime and builder logs stay in release/build.
  await fs.mkdir(releaseDirectory, { recursive: true });
  const executable = path.join(releaseDirectory, 'AnchorProposal.exe');
  await portable();
  const installer = path.join(releaseDirectory, 'AnchorProposal-Setup.exe');
  await fs.copyFile(path.join(root, 'release', 'build', 'AnchorProposal-Setup.exe'), installer);
  // Publishing remains an explicit Master action in Settings > Desktop app.
  console.log(`\nPortable Windows app: ${executable}\nSetup installer: ${installer}`);
})().catch(error => { console.error(error); process.exitCode = 1; });
