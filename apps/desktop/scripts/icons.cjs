// Code-drawn brand icon. No downloaded artwork or executable asset generators.
const fs = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');
function crc32(bytes) { let c = 0xffffffff; for (const byte of bytes) { c ^= byte; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0); } return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const typeData = Buffer.concat([Buffer.from(type), data]); const result = Buffer.alloc(data.length + 12); result.writeUInt32BE(data.length); typeData.copy(result, 4); result.writeUInt32BE(crc32(typeData), result.length - 4); return result; }
function distance(x, y, a, b) { const dx = b[0] - a[0], dy = b[1] - a[1]; const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy))); return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy); }
function png(size, transparent = false) {
  const rows = Buffer.alloc((size * 4 + 1) * size);
  const lines = [[[50,34],[50,77]],[[31,45],[69,45]],[[24,62],[27,70]],[[27,70],[36,77]],[[36,77],[50,80]],[[50,80],[64,77]],[[64,77],[73,70]],[[73,70],[76,62]],[[24,62],[22,72]],[[24,62],[34,64]],[[76,62],[78,72]],[[76,62],[66,64]]];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const px = (x + .5) * 100 / size, py = (y + .5) * 100 / size;
    const ring = Math.abs(Math.hypot(px - 50, py - 25) - 8);
    const ink = Math.min(ring, ...lines.map(([a,b]) => distance(px,py,a,b)));
    const rounded = Math.hypot(Math.max(Math.abs(px - 50) - 30, 0), Math.max(Math.abs(py - 50) - 30, 0));
    const index = y * (size * 4 + 1) + 1 + x * 4;
    const alpha = Math.max(0, Math.min(1, (3.2 - ink) * size / 100));
    const background = transparent || rounded > 18 ? 0 : 1;
    const color = [128, 226, 190]; const base = [14 + py * .12, 40 + px * .2, 38 + py * .08];
    for (let c = 0; c < 3; c++) rows[index+c] = background ? base[c] * (1-alpha) + color[c] * alpha : color[c];
    rows[index+3] = 255 * (background || alpha);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size,4); header[8]=8; header[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
}
async function createIcons(directory) {
  await fs.mkdir(directory,{recursive:true}); const icon = png(256);
  const header=Buffer.alloc(22); header.writeUInt16LE(1,2);header.writeUInt16LE(1,4);header.writeUInt16LE(1,10);header.writeUInt16LE(32,12);header.writeUInt32LE(icon.length,14);header.writeUInt32LE(22,18);
  await fs.writeFile(path.join(directory,'icon.ico'),Buffer.concat([header,icon]));
  await fs.writeFile(path.join(directory,'icon.png'),icon); await fs.writeFile(path.join(directory,'tray.png'),png(32,true));
}
module.exports={createIcons};
