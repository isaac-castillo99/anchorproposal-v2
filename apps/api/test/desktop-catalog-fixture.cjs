const structuredCopy = value => JSON.parse(JSON.stringify(value));
function memoryDatabase() {
  let catalog = null; let tail = Promise.resolve(); const audits = [];
  const database = {
    audits,
    systemSetting: {
      findUnique: async () => catalog === null ? null : ({ value: catalog }),
      upsert: async ({ create }) => { catalog = create.value; return { value: catalog }; },
    },
    auditEvent: { create: async ({ data }) => { audits.push(structuredCopy(data)); return data; } },
    $queryRaw: async () => [],
    $executeRaw: async () => 1,
    $transaction: operation => {
      const pending = tail.then(async () => {
        const before = catalog; const auditCount = audits.length;
        try { return await operation(database); }
        catch (error) { catalog = before; audits.splice(auditCount); throw error; }
      });
      tail = pending.catch(() => undefined); return pending;
    },
  };
  return database;
}
function windowsExe(marker = 'QA release') {
  const file = Buffer.alloc(128); file.write('MZ'); file.writeUInt32LE(64, 60);
  file.write('PE\0\0', 64); file.writeUInt16LE(0x14c, 68); file.write(marker, 80); return file;
}
module.exports = { memoryDatabase, windowsExe };
