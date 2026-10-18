import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

let cachedKey: Buffer | null = null;

/**
 * Clé maîtresse AES-256 qui chiffre les secrets des intégrations.
 * Priorité à SECRET_KEY (base64, 32 octets). Sinon, une clé est générée une fois
 * dans DATA_DIR/secret.key (droits 600) : la sauvegarder avec la base de données.
 */
export function masterKey(): Buffer {
  if (cachedKey) return cachedKey;
  if (config.secretKey) {
    const key = Buffer.from(config.secretKey, 'base64');
    if (key.length !== 32) throw new Error('SECRET_KEY doit faire 32 octets encodés en base64 (npm run gen-key).');
    cachedKey = key;
    return key;
  }
  const file = path.join(config.dataDir, 'secret.key');
  fs.mkdirSync(config.dataDir, { recursive: true });
  if (fs.existsSync(file)) {
    cachedKey = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'base64');
  } else {
    cachedKey = crypto.randomBytes(32);
    fs.writeFileSync(file, cachedKey.toString('base64'), { mode: 0o600 });
  }
  if (cachedKey.length !== 32) throw new Error(`Clé invalide dans ${file}`);
  return cachedKey;
}

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', masterKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':');
}

export function decrypt(payload: string): string {
  const [version, ivB64, tagB64, ctB64] = payload.split(':');
  if (version !== 'v1' || !ivB64 || !tagB64 || ctB64 === undefined) throw new Error('Format chiffré inconnu');
  const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
}

export function encryptJson(value: unknown): string {
  return encrypt(JSON.stringify(value));
}

export function decryptJson<T>(payload: string | null | undefined, fallback: T): T {
  if (!payload) return fallback;
  try {
    return JSON.parse(decrypt(payload)) as T;
  } catch {
    return fallback;
  }
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 64, maxmem: 96 * 1024 * 1024 };

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: SCRYPT.maxmem });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

export function verifyPassword(password: string, stored: string): boolean {
  const [algo, n, r, p, saltB64, hashB64] = stored.split('$');
  if (algo !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT.maxmem,
  });
  return crypto.timingSafeEqual(actual, expected);
}

/** Variante asynchrone (hors de la boucle d'événements) pour la connexion. */
export async function verifyPasswordAsync(password: string, stored: string): Promise<boolean> {
  const [algo, n, r, p, saltB64, hashB64] = stored.split('$');
  if (algo !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await new Promise<Buffer>((resolve, reject) =>
    crypto.scrypt(
      password,
      Buffer.from(saltB64, 'base64'),
      expected.length,
      { N: Number(n), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem },
      (err, key) => (err ? reject(err) : resolve(key)),
    ),
  );
  return crypto.timingSafeEqual(actual, expected);
}

/** Aperçu masqué d'un secret : quatre derniers caractères seulement. */
export function previewSecret(value: string): string {
  if (!value) return '';
  return '••••' + value.slice(-4);
}
