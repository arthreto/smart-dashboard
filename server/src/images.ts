import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { config } from './config.js';
import { sha256 } from './crypto.js';
import { fetchRaw } from './http.js';

/** Hôtes autorisés pour le proxy d'images (évite d'en faire un proxy ouvert). */
const ALLOWED_HOSTS = [/^i\.scdn\.co$/, /^mosaic\.scdn\.co$/, /^image-cdn-[a-z]+\.spotifycdn\.com$/, /^([a-z0-9-]+\.)*pathe\.fr$/, /^([a-z0-9-]+\.)*pathe-ms\.fr$/];
const MAX_BYTES = 6 * 1024 * 1024;

export function imageUrlFor(src: string, w: number, h: number): string {
  return `/api/v1/image?src=${encodeURIComponent(src)}&w=${w}&h=${h}`;
}

export function isAllowedImage(src: string): boolean {
  try {
    const u = new URL(src);
    return u.protocol === 'https:' && ALLOWED_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

const cacheDir = () => path.join(config.dataDir, 'image-cache');

/**
 * Télécharge, recadre et réencode une image en JPEG « baseline » :
 * le décodeur JPEG de LVGL (TJPGD) ne lit pas le JPEG progressif.
 */
export async function processImage(src: string, w: number, h: number): Promise<Buffer> {
  const width = Math.max(16, Math.min(640, Math.round(w)));
  const height = Math.max(16, Math.min(640, Math.round(h)));
  const file = path.join(cacheDir(), `${sha256(`${src}|${width}x${height}`)}.jpg`);
  if (fs.existsSync(file)) return fs.promises.readFile(file);

  const res = await fetchRaw(src, { timeoutMs: 15_000 });
  if (!res.ok) throw new Error(`Image indisponible (${res.status})`);
  const len = Number(res.headers.get('content-length') ?? 0);
  if (len > MAX_BYTES) throw new Error('Image trop lourde');
  const input = Buffer.from(await res.arrayBuffer());
  if (input.length > MAX_BYTES) throw new Error('Image trop lourde');

  const out = await sharp(input, { failOn: 'none' })
    .resize(width, height, { fit: 'cover', position: 'attention' })
    .jpeg({ quality: 82, progressive: false, mozjpeg: false, chromaSubsampling: '4:2:0' })
    .toBuffer();
  await fs.promises.mkdir(cacheDir(), { recursive: true });
  await fs.promises.writeFile(file, out);
  return out;
}

/** Vide les images en cache de plus de `days` jours. */
export async function pruneImageCache(days = 14): Promise<void> {
  const dir = cacheDir();
  if (!fs.existsSync(dir)) return;
  const limit = Date.now() - days * 86400_000;
  for (const name of await fs.promises.readdir(dir)) {
    const f = path.join(dir, name);
    const st = await fs.promises.stat(f);
    if (st.mtimeMs < limit) await fs.promises.unlink(f).catch(() => undefined);
  }
}

/** Convertit une capture RGB565 (little-endian) envoyée par la tablette en JPEG. */
export async function rgb565ToJpeg(raw: Buffer, width: number, height: number): Promise<Buffer> {
  if (raw.length < width * height * 2) throw new Error('Capture incomplète');
  const rgb = Buffer.alloc(width * height * 3);
  for (let i = 0, j = 0; i < width * height; i++, j += 3) {
    const v = raw[i * 2] | (raw[i * 2 + 1] << 8);
    const r = (v >> 11) & 0x1f;
    const g = (v >> 5) & 0x3f;
    const b = v & 0x1f;
    rgb[j] = (r << 3) | (r >> 2);
    rgb[j + 1] = (g << 2) | (g >> 4);
    rgb[j + 2] = (b << 3) | (b >> 2);
  }
  return sharp(rgb, { raw: { width, height, channels: 3 } }).jpeg({ quality: 85 }).toBuffer();
}
