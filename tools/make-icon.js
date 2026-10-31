// Dessine l'icône du launcher (une feuille sur un carré arrondi en dégradé) en PNG RGBA,
// puis l'emballe dans un .ico (entrées PNG 256, 64, 48 et 32). Sans dépendance : node tools/make-icon.js
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

function crcTable() {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
}
const TABLE = crcTable();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const mix = (a, b, t) => a + (b - a) * t;
const clamp = (v) => Math.max(0, Math.min(1, v));

// Distance signée d'un carré arrondi centré (coordonnées 0..1).
function roundedBox(x, y, half, r) {
  const qx = Math.abs(x - 0.5) - half + r;
  const qy = Math.abs(y - 0.5) - half + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

// La feuille : intersection de deux disques, inclinée à 45°, avec une nervure.
function leaf(x, y) {
  const a = -Math.PI / 4;
  const cx = x - 0.5, cy = y - 0.52;
  const u = cx * Math.cos(a) - cy * Math.sin(a);
  const v = cx * Math.sin(a) + cy * Math.cos(a);
  const R = 0.36, off = 0.2;
  const d1 = Math.hypot(u, v - off) - R;
  const d2 = Math.hypot(u, v + off) - R;
  const body = Math.max(d1, d2);
  const vein = Math.abs(v) - 0.012 + (Math.abs(u) > 0.27 ? 1 : 0);
  return { body, vein, u };
}

function draw(size) {
  const buf = Buffer.alloc(size * size * 4);
  const ss = 4;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, al = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const x = (px + (sx + 0.5) / ss) / size;
          const y = (py + (sy + 0.5) / ss) / size;
          const box = roundedBox(x, y, 0.46, 0.13);
          if (box > 0) continue;
          // Fond : dégradé nuit → émeraude profonde.
          const t = clamp((x + y) / 2);
          let cr = mix(10, 6, t), cg = mix(26, 60, t), cb = mix(22, 44, t);
          // Halo derrière la feuille.
          const glow = clamp(1 - Math.hypot(x - 0.5, y - 0.5) / 0.45);
          cr += 20 * glow * glow; cg += 90 * glow * glow; cb += 50 * glow * glow;
          const lf = leaf(x, y);
          if (lf.body < 0) {
            const k = clamp((lf.u + 0.3) / 0.6);
            cr = mix(150, 40, k); cg = mix(255, 200, k); cb = mix(140, 110, k);
            if (lf.vein < 0) { cr = 14; cg = 70; cb = 48; }
          }
          r += cr; g += cg; b += cb; al += 255;
        }
      }
      const n = ss * ss;
      const i = (py * size + px) * 4;
      const cover = al / n / 255;
      buf[i] = cover ? r / (al / 255) : 0;
      buf[i + 1] = cover ? g / (al / 255) : 0;
      buf[i + 2] = cover ? b / (al / 255) : 0;
      buf[i + 3] = Math.round(cover * 255);
    }
  }
  return png(size, buf);
}

const out = path.join(__dirname, "..", "icons");
fs.mkdirSync(out, { recursive: true });
const sizes = [256, 64, 48, 32];
const images = sizes.map(draw);
fs.writeFileSync(path.join(out, "icon.png"), images[0]);
fs.writeFileSync(path.join(__dirname, "..", "ui", "icon.png"), images[0]);
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((s, i) => {
  const e = 6 + 16 * i;
  header[e] = s >= 256 ? 0 : s;
  header[e + 1] = s >= 256 ? 0 : s;
  header.writeUInt16LE(1, e + 4);
  header.writeUInt16LE(32, e + 6);
  header.writeUInt32LE(images[i].length, e + 8);
  header.writeUInt32LE(offset, e + 12);
  offset += images[i].length;
});
fs.writeFileSync(path.join(out, "icon.ico"), Buffer.concat([header, ...images]));
console.log("icons/icon.png + icons/icon.ico");
