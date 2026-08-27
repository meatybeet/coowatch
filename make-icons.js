// One-off generator for the PWA icons. Run: node make-icons.js
const fs = require('fs');
const zlib = require('zlib');

function png(size) {
  const bytes = Buffer.alloc(size * size * 4);
  const r = size * 0.22;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // rounded square background
      const cx = Math.min(Math.max(x, r), size - r);
      const cy = Math.min(Math.max(y, r), size - r);
      const inside = Math.hypot(x - cx, y - cy) <= r;
      let [cr, cg, cb] = inside ? [124, 92, 255] : [0, 0, 0];
      const a = inside ? 255 : 0;
      // white play triangle
      const px = (x - size * 0.40) / size;
      const py = (y - size * 0.5) / size;
      if (inside && px >= 0 && px <= 0.26 && Math.abs(py) <= 0.16 * (1 - px / 0.26)) {
        [cr, cg, cb] = [255, 255, 255];
      }
      bytes[i] = cr; bytes[i + 1] = cg; bytes[i + 2] = cb; bytes[i + 3] = a;
    }
  }

  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    bytes.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

let table = null;
function crc32(buf) {
  if (!table) {
    table = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

fs.writeFileSync('public/icons/icon-192.png', png(192));
fs.writeFileSync('public/icons/icon-512.png', png(512));
console.log('icons written');
