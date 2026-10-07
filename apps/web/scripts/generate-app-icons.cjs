// Reuse the existing vector brand mark; keep its artwork within the maskable safe area.
const fs = require('node:fs/promises');
const path = require('node:path');
const { createRequire } = require('node:module');
const nextRequire = createRequire(require.resolve('next/package.json'));
const sharp = nextRequire('sharp');
(async () => {
  const directory = path.resolve(__dirname, '../public/icons');
  const brand = await fs.readFile(path.resolve(__dirname, '../public/brand-mark.svg'), 'utf8');
  const artwork = brand.replace(/<svg[^>]*>|<\/svg>/g, '').replace(/currentColor/g, '#a5ecd1');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" fill="none"><rect width="512" height="512" fill="#095d63"/><g transform="translate(116 116) scale(7)">${artwork}</g></svg>`;
  await fs.mkdir(directory, { recursive: true });
  for (const size of [192, 512]) await sharp(Buffer.from(svg)).resize(size, size).png().toFile(path.join(directory, `app-${size}.png`));
  console.log('Generated 192px and 512px web app icons.');
})().catch(error => { console.error(error); process.exitCode = 1; });
