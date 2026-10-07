const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
function run(script, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { cwd: root, stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Packaging step failed (${code}).`)));
  });
}
function portable() {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'package-portable.ps1')], { cwd: root, stdio: 'inherit', windowsHide: true });
    child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Portable packaging failed (${code}).`)));
  });
}
(async () => {
  await run(path.join(__dirname, 'build.cjs'));
  await run(require.resolve('electron-builder/cli.js'), ['--win', 'nsis', '--x64']);
  // Each download is one executable. Intermediate runtime and builder logs stay in release/build.
  const destination = path.join(root, 'release', 'standalone');
  await fs.mkdir(destination, { recursive: true });
  const executable = path.join(destination, 'AnchorProposal.exe');
  await portable();
  const setupDirectory = path.join(root, 'release', 'setup');
  await fs.mkdir(setupDirectory, { recursive: true });
  const installer = path.join(setupDirectory, 'AnchorProposal-Setup.exe');
  await fs.copyFile(path.join(root, 'release', 'build', 'AnchorProposal-Setup.exe'), installer);
  // Publishing remains an explicit Master action in Settings > Desktop app.
  console.log(`\nPortable Windows app: ${executable}\nSetup installer: ${installer}`);
})().catch(error => { console.error(error); process.exitCode = 1; });
