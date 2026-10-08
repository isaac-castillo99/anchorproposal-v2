const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');

const apiRoot = path.resolve(__dirname, '..');
// Prisma formats the copied schema. Compare tokens while preserving quoted values.
const normalize = text => (text.match(/"(?:\\.|[^"\\])*"|\/\/[^\r\n]*|\/\*[\s\S]*?\*\/|\w+|[^\s]/g) || [])
  .filter(token => !token.startsWith('//') && !token.startsWith('/*')).join(' ');

function checkClient(root) {
  const load = createRequire(path.join(root, 'package.json'));
  const clientEntry = load.resolve('@prisma/client');
  const generatedEntry = createRequire(clientEntry).resolve('.prisma/client/default');
  const generatedSchema = path.join(path.dirname(generatedEntry), 'schema.prisma');
  if (!fs.existsSync(generatedSchema)) throw new Error('The Prisma client has not been generated.');
  const schema = fs.readFileSync(path.join(root, 'prisma/schema.prisma'), 'utf8');
  if (normalize(fs.readFileSync(generatedSchema, 'utf8')) !== normalize(schema)) {
    throw new Error('The Prisma client was generated from a different schema.');
  }
  const client = load('@prisma/client');
  if (typeof client.PrismaClient !== 'function' ||
      !['MASTER', 'ADMIN', 'BIDDER'].every(role => client.UserRole?.[role] === role)) {
    throw new Error('The Prisma client is missing the application role enums.');
  }
  if (client.Prisma?.prismaVersion?.client !== load('@prisma/client/package.json').version) {
    throw new Error('The generated Prisma client does not match the installed client version.');
  }
}

function inspect(root) {
  // Use a fresh process so a placeholder loaded before generation cannot stay cached.
  const result = spawnSync(process.execPath, [__filename, '--check', root], {
    cwd: root, encoding: 'utf8', windowsHide: true,
  });
  if (result.error) throw result.error;
  return result;
}

function ensurePrismaClient(root = apiRoot) {
  const before = inspect(root);
  if (before.status === 0) return;
  console.log(`[prisma] ${before.stderr.trim() || 'The generated client is unavailable.'} Regenerating…`);
  const load = createRequire(path.join(root, 'package.json'));
  let cli;
  try {
    cli = path.join(path.dirname(load.resolve('prisma/package.json')), 'build/index.js');
  } catch {
    throw new Error('Prisma CLI is unavailable. Install build dependencies and run pnpm db:generate before starting the API.');
  }
  const generated = spawnSync(process.execPath, [cli, 'generate', '--schema', path.join(root, 'prisma/schema.prisma')], {
    cwd: root, stdio: 'inherit', windowsHide: true,
  });
  if (generated.error) throw generated.error;
  if (generated.status !== 0) {
    throw new Error('Prisma client generation failed. Fix the error above, then run pnpm db:generate. The API was not started.');
  }
  const after = inspect(root);
  if (after.status !== 0) {
    throw new Error(`Prisma generation did not produce a usable client: ${after.stderr.trim()}`);
  }
  console.log('[prisma] Client ready.');
}

if (require.main === module) {
  try {
    if (process.argv[2] === '--check') checkClient(process.argv[3] || apiRoot);
    else ensurePrismaClient();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { ensurePrismaClient };
