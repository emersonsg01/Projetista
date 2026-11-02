// Gera o ícone do app (256×256 PNG) sem dependências: losango laranja com brilho.
import fs from 'node:fs';
import { encodePNG } from '../src/render/raster.js';
const S = 256, px = Buffer.alloc(S * S * 3);
for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
  const o = (y * S + x) * 3, cx = x - S / 2 + 0.5, cy = y - S / 2 + 0.5;
  const r = Math.hypot(cx, cy);
  let c = [21, 24, 29];
  if (Math.max(Math.abs(cx), Math.abs(cy)) < 120 && r < 150) c = [28, 32, 39];
  const d = Math.abs(cx) + Math.abs(cy);
  if (d < 92) { const t = (cy + 92) / 184; c = [255, 138 + (1 - t) * 50, 61 + (1 - t) * 40].map((v) => Math.min(255, v * (cx < 0 ? 1 : 0.86))); }
  if (d >= 92 && d < 100) c = [255, 170, 110];
  px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2];
}
fs.writeFileSync('build/icon.png', encodePNG(S, S, px));
console.log('build/icon.png');
