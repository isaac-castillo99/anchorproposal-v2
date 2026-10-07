const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const main = path.resolve(__dirname, '../main/index.cjs');
const mainRequire = createRequire(main);

function fixture(filename, cancelled = false) {
  const handlers = new Map();
  let saveOptions, written, requests = 0;
  const electron = {
    app: { isPackaged: false, requestSingleInstanceLock: () => false, quit() {} },
    protocol: { registerSchemesAsPrivileged() {} },
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    dialog: { showSaveDialog: async (_window, options) => {
      saveOptions = options;
      return { canceled: cancelled, filePath: path.join('C:\\Downloads', options.defaultPath) };
    } },
  };
  const webContents = { mainFrame: { url: 'anchor://app/index.html' } };
  const context = vm.createContext({
    require: name => name === 'electron' ? electron : name === 'node:fs/promises' ? { writeFile: async (destination, data) => { written = { destination, data }; } } : mainRequire(name),
    process: { env: {}, argv: [] }, Buffer, AbortSignal, URL,
    mockWindow: { webContents, isDestroyed: () => false },
    mockAuth: { request: async (_route, options) => {
      requests++;
      return options.binary ? new Response('document bytes') : { id: 'file-1', filename };
    } },
  });
  vm.runInContext(fs.readFileSync(main, 'utf8') + '\nwindow = mockWindow; auth = mockAuth; installHandlers();', context);
  return {
    export: (kind, type) => handlers.get('anchor:export')({ sender: webContents, senderFrame: webContents.mainFrame }, 'generation-1', type, kind),
    result: () => ({ saveOptions, written, requests }),
  };
}

for (const kind of ['RESUME', 'COVER_LETTER']) for (const type of ['PDF', 'DOCX']) {
  test(`desktop ${kind} ${type} save dialog uses the server's profile filename`, async () => {
    const filename = `Zoë Anne 李${kind === 'COVER_LETTER' ? '_cover letter' : ''}.${type.toLowerCase()}`;
    const f = fixture(filename);
    const result = await f.export(kind, type);
    assert.equal(result.ok, true);
    assert.equal(f.result().saveOptions.defaultPath, filename);
    assert.equal(path.basename(f.result().written.destination), filename);
    assert.equal(f.result().written.data.toString(), 'document bytes');
  });
}

test('cancelling the desktop save dialog does not write a file', async () => {
  const f = fixture('Alex Example.pdf', true);
  const result = await f.export('RESUME', 'PDF');
  assert.equal(result.value.cancelled, true);
  assert.equal(f.result().requests, 2);
  assert.equal(f.result().written, undefined);
});
