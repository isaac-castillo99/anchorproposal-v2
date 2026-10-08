const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
(async () => {
  const directory = path.resolve(__dirname, '../../..', 'tmp/desktop-qa', `native-${Date.now()}`);
  await fs.mkdir(directory, { recursive: true });
  // Reproduce an upgrade from the old configurable localhost connection.
  await fs.writeFile(path.join(directory, 'settings.json'), JSON.stringify({ server: 'http://localhost:3001', hotkey: 'Control+Shift+Z', notifications: false }));
  await fs.writeFile(path.join(directory, 'session.json'), JSON.stringify({ server: 'http://localhost:3001', encrypted: Buffer.from('old-server-session').toString('base64') }));
  const env = { ...process.env, ANCHOR_DESKTOP_SMOKE_DIR: directory }; delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'), ['.'], { cwd: path.resolve(__dirname, '..'), env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; child.stdout.on('data', b => log += b); child.stderr.on('data', b => log += b);
  const timeout = setTimeout(() => child.kill(), 300000);
  child.on('error', error => { clearTimeout(timeout); console.error(error); process.exitCode = 1; });
  child.on('exit', async code => {
    clearTimeout(timeout); await fs.writeFile(path.join(directory, 'native.log'), log);
    if (code !== 0) { console.error(await fs.readFile(path.join(directory, 'error.txt'), 'utf8').catch(() => log)); process.exitCode = 1; }
    else console.log(await fs.readFile(path.join(directory, 'result.json'), 'utf8'));
    console.log(`Native QA artifacts: ${directory}`);
  });
})().catch(error => { console.error(error); process.exitCode = 1; });
