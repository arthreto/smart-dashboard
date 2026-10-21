// Chiffrement de la galerie, entièrement dans le navigateur (WebCrypto).
//
// - Paire RSA-OAEP 3072 bits (SHA-256) par compte. La clé privée est chiffrée en AES-GCM
//   avec une clé dérivée du code secret (PBKDF2-SHA256, 600 000 itérations) : le serveur
//   ne reçoit que ce résultat, jamais le code ni la clé privée en clair.
// - Chaque vidéo a sa clé AES-256 et son préfixe de nonce, chiffrés par la tablette avec
//   la clé publique. Morceau n : AES-256-GCM, nonce = préfixe (8 octets) + n (32 bits,
//   gros-boutiste), données associées = « sdv1:<vidéo>:<n>:<1 si dernier, sinon 0> ».

const subtle = () => {
  if (!globalThis.crypto?.subtle) throw new Error('Ce navigateur ne permet pas le chiffrement (page non sécurisée ?).');
  return globalThis.crypto.subtle;
};

export const PBKDF2_ITERATIONS = 600_000;
export const MIN_CODE_LENGTH = 8;

export interface GalleryKeys {
  publicKey: string;
  privateKeyEnc: string;
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string; iv: string };
}

export function toB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function codeKey(code: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await subtle().importKey('raw', new TextEncoder().encode(code.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
}

async function wrapPrivate(pkcs8: ArrayBuffer, code: string): Promise<Pick<GalleryKeys, 'privateKeyEnc' | 'kdf'>> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await codeKey(code, salt, PBKDF2_ITERATIONS);
  const enc = await subtle().encrypt({ name: 'AES-GCM', iv }, key, pkcs8);
  return {
    privateKeyEnc: toB64(enc),
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: PBKDF2_ITERATIONS, salt: toB64(salt), iv: toB64(iv) },
  };
}

/** Nouvelle paire de clés protégée par `code` (première configuration). */
export async function createKeys(code: string): Promise<GalleryKeys> {
  const pair = await subtle().generateKey(
    { name: 'RSA-OAEP', modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['encrypt', 'decrypt'],
  );
  const spki = await subtle().exportKey('spki', pair.publicKey);
  const pkcs8 = await subtle().exportKey('pkcs8', pair.privateKey);
  return { publicKey: toB64(spki), ...(await wrapPrivate(pkcs8, code)) };
}

/** Déchiffre la clé privée avec le code ; null si le code est faux. */
async function openPrivate(keys: GalleryKeys, code: string): Promise<ArrayBuffer | null> {
  const key = await codeKey(code, fromB64(keys.kdf.salt), keys.kdf.iterations);
  try {
    return await subtle().decrypt({ name: 'AES-GCM', iv: fromB64(keys.kdf.iv) }, key, fromB64(keys.privateKeyEnc));
  } catch {
    return null;
  }
}

/** Clé privée utilisable (non exportable), ou null si le code est faux. */
export async function unlock(keys: GalleryKeys, code: string): Promise<CryptoKey | null> {
  const pkcs8 = await openPrivate(keys, code);
  if (!pkcs8) return null;
  return subtle().importKey('pkcs8', pkcs8, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt']);
}

/** Même clé privée, chiffrée avec un nouveau code. */
export async function rewrap(keys: GalleryKeys, oldCode: string, newCode: string): Promise<Pick<GalleryKeys, 'privateKeyEnc' | 'kdf'> | null> {
  const pkcs8 = await openPrivate(keys, oldCode);
  if (!pkcs8) return null;
  return wrapPrivate(pkcs8, newCode);
}

export interface VideoKey {
  key: CryptoKey;
  prefix: Uint8Array;
}

export async function openVideoKey(priv: CryptoKey, wrappedKey: string, noncePrefix: string): Promise<VideoKey> {
  const raw = new Uint8Array(await subtle().decrypt({ name: 'RSA-OAEP' }, priv, fromB64(wrappedKey)));
  if (raw.length !== 40) throw new Error('Clé de la vidéo invalide.');
  const key = await subtle().importKey('raw', raw.slice(0, 32), 'AES-GCM', false, ['decrypt']);
  return { key, prefix: fromB64(noncePrefix) };
}

export async function decryptChunk(vk: VideoKey, videoId: string, n: number, final: boolean, data: ArrayBuffer): Promise<Uint8Array> {
  const iv = new Uint8Array(12);
  iv.set(vk.prefix.subarray(0, 8));
  new DataView(iv.buffer).setUint32(8, n);
  const aad = new TextEncoder().encode(`sdv1:${videoId}:${n}:${final ? 1 : 0}`);
  try {
    return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv, additionalData: aad }, vk.key, data));
  } catch {
    throw new Error(`Morceau ${n} illisible : fichier abîmé ou modifié.`);
  }
}
