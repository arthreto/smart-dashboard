// Galerie : vidéos enregistrées par les écrans, chiffrées de bout en bout.
//
// - Le navigateur crée une paire de clés RSA-OAEP pour le compte. Il envoie la clé publique
//   et la clé privée chiffrée (AES-GCM) par une clé dérivée du code secret (PBKDF2) : le
//   code ne quitte jamais le navigateur, le serveur ne peut rien déchiffrer.
// - Pour enregistrer, la tablette reçoit la clé publique. Elle tire une clé AES-256 propre
//   à la vidéo, la chiffre avec la clé publique, puis envoie la vidéo par morceaux chiffrés
//   (AES-256-GCM). Le serveur ne stocke que ces morceaux, sans pouvoir les lire.
// - Le navigateur, une fois le code saisi, déchiffre la clé privée, puis la clé de la
//   vidéo, puis les morceaux, et reconstruit un fichier MP4.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { main } from './households.js';
import { ValidationError } from './habits.js';
import { NotFoundError } from './http.js';
import type { DeviceRow } from './device.js';

export const MAX_CHUNK_BYTES = 4 * 1024 * 1024;
const MAX_VIDEO_BYTES = 4 * 1024 ** 3;
/** Délai pour que l'écran démarre l'enregistrement demandé (sinon : annulé). */
export const START_TIMEOUT_MS = 2 * 60_000;
/** Sans nouveau morceau depuis ce délai, l'enregistrement est considéré comme interrompu. */
const STALL_MS = 3 * 60_000;

function quotaBytes(): number {
  const gb = Number(process.env.GALLERY_MAX_GB ?? 20);
  return (Number.isFinite(gb) && gb > 0 ? gb : 20) * 1024 ** 3;
}

export function galleryDir(userId: number): string {
  return path.join(config.dataDir, 'gallery', String(userId));
}

function videoDir(userId: number, id: string): string {
  return path.join(galleryDir(userId), id);
}

export function chunkFile(userId: number, id: string, n: number): string {
  return path.join(videoDir(userId, id), `${n}.bin`);
}

const VIDEO_ID = /^[A-Za-z0-9_-]{16}$/;

export function checkVideoId(id: unknown): string {
  if (typeof id !== 'string' || !VIDEO_ID.test(id)) throw new NotFoundError('Vidéo introuvable.');
  return id;
}

// ---------------------------------------------------------------- clés du compte

export interface GalleryKeys {
  publicKey: string;
  privateKeyEnc: string;
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string; iv: string };
}

function b64(value: unknown, what: string, min: number, max: number): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new ValidationError(`${what} : base64 attendu.`);
  const n = Buffer.from(value, 'base64').length;
  if (n < min || n > max) throw new ValidationError(`${what} : taille invalide.`);
  return value;
}

function parseKdf(input: unknown): GalleryKeys['kdf'] {
  const k = (input ?? {}) as Record<string, unknown>;
  const iterations = Number(k.iterations);
  if (!Number.isInteger(iterations) || iterations < 200_000 || iterations > 10_000_000) {
    throw new ValidationError('Nombre d’itérations PBKDF2 invalide.');
  }
  return { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: b64(k.salt, 'Sel', 16, 64), iv: b64(k.iv, 'IV', 12, 12) };
}

function checkPublicKey(value: unknown): string {
  const spki = b64(value, 'Clé publique', 200, 1200);
  let bits = 0;
  try {
    const key = crypto.createPublicKey({ key: Buffer.from(spki, 'base64'), format: 'der', type: 'spki' });
    if (key.asymmetricKeyType !== 'rsa') throw new Error();
    bits = key.asymmetricKeyDetails?.modulusLength ?? 0;
  } catch {
    throw new ValidationError('Clé publique RSA invalide.');
  }
  if (bits < 3072 || bits > 4096) throw new ValidationError('La clé RSA doit faire 3072 ou 4096 bits.');
  return spki;
}

export function getKeys(userId: number): GalleryKeys | null {
  const row = main().prepare('SELECT public_key, private_key_enc, kdf FROM gallery_keys WHERE user_id = ?').get(userId) as
    | { public_key: string; private_key_enc: string; kdf: string }
    | undefined;
  if (!row) return null;
  return { publicKey: row.public_key, privateKeyEnc: row.private_key_enc, kdf: JSON.parse(row.kdf) };
}

/** Première configuration (clé publique + clé privée protégée par le code). */
export function setupKeys(userId: number, body: Record<string, unknown>): void {
  if (getKeys(userId)) throw new ValidationError('La galerie est déjà protégée par un code.');
  const publicKey = checkPublicKey(body.publicKey);
  const privateKeyEnc = b64(body.privateKeyEnc, 'Clé privée chiffrée', 1000, 4000);
  const kdf = parseKdf(body.kdf);
  const now = new Date().toISOString();
  main()
    .prepare('INSERT INTO gallery_keys (user_id, public_key, private_key_enc, kdf, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(userId, publicKey, privateKeyEnc, JSON.stringify(kdf), now, now);
}

/** Nouveau code : même paire de clés, clé privée chiffrée autrement. */
export function changeCode(userId: number, body: Record<string, unknown>): void {
  if (!getKeys(userId)) throw new NotFoundError('Galerie non configurée.');
  const privateKeyEnc = b64(body.privateKeyEnc, 'Clé privée chiffrée', 1000, 4000);
  const kdf = parseKdf(body.kdf);
  main()
    .prepare('UPDATE gallery_keys SET private_key_enc = ?, kdf = ?, updated_at = ? WHERE user_id = ?')
    .run(privateKeyEnc, JSON.stringify(kdf), new Date().toISOString(), userId);
}

/** Code oublié : tout est effacé (clés et vidéos, devenues illisibles). */
export function resetGallery(userId: number): void {
  main().prepare('DELETE FROM gallery_videos WHERE user_id = ?').run(userId);
  main().prepare('DELETE FROM gallery_keys WHERE user_id = ?').run(userId);
  fs.rmSync(galleryDir(userId), { recursive: true, force: true });
}

// ---------------------------------------------------------------- vidéos

export interface VideoRow {
  id: string;
  user_id: number;
  device_id: number;
  device_name: string;
  status: 'waiting' | 'recording' | 'done' | 'error' | 'cancelled';
  stop_requested: number;
  error: string;
  wrapped_key: string | null;
  nonce_prefix: string | null;
  chunks: number;
  bytes: number;
  complete: number;
  duration_ms: number | null;
  created_at: string;
  started_at: string | null;
  last_chunk_at: string | null;
  ended_at: string | null;
}

/** Corrige l'état des vidéos abandonnées (écran jamais démarré, ou disparu en cours de route). */
function settle(v: VideoRow, now = Date.now()): VideoRow {
  if (v.status === 'waiting' && now - Date.parse(v.created_at) > START_TIMEOUT_MS) {
    const error = v.stop_requested ? '' : 'L’écran n’a pas démarré l’enregistrement (hors ligne ?).';
    main().prepare("UPDATE gallery_videos SET status = 'cancelled', error = ?, ended_at = ? WHERE id = ?").run(error, new Date(now).toISOString(), v.id);
    return { ...v, status: 'cancelled', error };
  }
  if (v.status === 'recording') {
    const last = Date.parse(v.last_chunk_at ?? v.started_at ?? v.created_at);
    if (now - last > STALL_MS) {
      const error = 'Enregistrement interrompu (écran éteint ou hors ligne) : la vidéo s’arrête au dernier morceau reçu.';
      main().prepare("UPDATE gallery_videos SET status = 'error', error = ?, ended_at = ? WHERE id = ?").run(error, v.last_chunk_at ?? v.created_at, v.id);
      return { ...v, status: 'error', error, ended_at: v.last_chunk_at ?? v.created_at };
    }
  }
  return v;
}

export function videoDto(v: VideoRow) {
  return {
    id: v.id,
    deviceId: v.device_id,
    deviceName: v.device_name,
    status: v.status,
    stopRequested: !!v.stop_requested,
    error: v.error || null,
    chunks: v.chunks,
    bytes: v.bytes,
    complete: !!v.complete,
    durationMs: v.duration_ms,
    createdAt: v.created_at,
    startedAt: v.started_at,
    endedAt: v.ended_at,
  };
}

export function listVideos(userId: number) {
  const rows = main().prepare('SELECT * FROM gallery_videos WHERE user_id = ? ORDER BY created_at DESC').all(userId) as VideoRow[];
  const now = Date.now();
  return rows.map((r) => settle(r, now)).map(videoDto);
}

export function usedBytes(userId: number): number {
  return (main().prepare('SELECT COALESCE(SUM(bytes), 0) AS n FROM gallery_videos WHERE user_id = ?').get(userId) as { n: number }).n;
}

export function getVideo(userId: number, id: string): VideoRow {
  const v = main().prepare('SELECT * FROM gallery_videos WHERE id = ? AND user_id = ?').get(checkVideoId(id), userId) as VideoRow | undefined;
  if (!v) throw new NotFoundError('Vidéo introuvable.');
  return settle(v);
}

/** Enregistrement en cours (ou demandé) sur cet écran, tous comptes confondus. */
export function activeOnDevice(deviceId: number): VideoRow | null {
  const rows = main().prepare("SELECT * FROM gallery_videos WHERE device_id = ? AND status IN ('waiting', 'recording')").all(deviceId) as VideoRow[];
  for (const r of rows) {
    const s = settle(r);
    if (s.status === 'waiting' || s.status === 'recording') return s;
  }
  return null;
}

/** Crée la vidéo et renvoie le texte de la commande « record_start » pour l'écran. */
export function createRecording(userId: number, d: DeviceRow): { video: VideoRow; command: string } {
  const keys = getKeys(userId);
  if (!keys) throw new ValidationError('Choisis d’abord le code secret de ta galerie.');
  if (!d.token_hash) throw new ValidationError('Cet écran n’est pas associé.');
  if (activeOnDevice(d.id)) throw new ValidationError('Un enregistrement est déjà en cours sur cet écran.');
  if (usedBytes(userId) >= quotaBytes()) throw new ValidationError('Galerie pleine : supprime des vidéos pour en enregistrer de nouvelles.');
  const id = crypto.randomBytes(12).toString('base64url');
  const now = new Date().toISOString();
  main()
    .prepare("INSERT INTO gallery_videos (id, user_id, device_id, device_name, status, created_at) VALUES (?, ?, ?, ?, 'waiting', ?)")
    .run(id, userId, d.id, d.name, now);
  const video = main().prepare('SELECT * FROM gallery_videos WHERE id = ?').get(id) as VideoRow;
  return { video, command: JSON.stringify({ videoId: id, publicKey: keys.publicKey }) };
}

/** Demande d'arrêt depuis la console (l'écran l'apprend à son prochain envoi). */
export function requestStop(userId: number, id: string): VideoRow {
  const v = getVideo(userId, id);
  if (v.status === 'waiting') {
    main().prepare("UPDATE gallery_videos SET status = 'cancelled', stop_requested = 1, ended_at = ? WHERE id = ?").run(new Date().toISOString(), v.id);
  } else if (v.status === 'recording') {
    main().prepare('UPDATE gallery_videos SET stop_requested = 1 WHERE id = ?').run(v.id);
  }
  return getVideo(userId, id);
}

export function deleteVideo(userId: number, id: string): void {
  const v = getVideo(userId, id);
  main().prepare('DELETE FROM gallery_videos WHERE id = ?').run(v.id);
  fs.rmSync(videoDir(userId, v.id), { recursive: true, force: true });
}

// ---------------------------------------------------------------- côté écran

function deviceVideo(d: DeviceRow, id: unknown): VideoRow {
  const v = main().prepare('SELECT * FROM gallery_videos WHERE id = ? AND device_id = ?').get(checkVideoId(id), d.id) as VideoRow | undefined;
  if (!v) throw new NotFoundError('Vidéo introuvable.');
  return settle(v);
}

export class GalleryConflict extends Error {}

/** L'écran a démarré la capture : clé de la vidéo (chiffrée pour le compte) et préfixe des nonces. */
export function deviceStart(d: DeviceRow, id: unknown, body: Record<string, unknown>): void {
  const v = deviceVideo(d, id);
  if (v.status !== 'waiting' || v.stop_requested) throw new GalleryConflict('Enregistrement annulé.');
  const wrappedKey = b64(body.wrappedKey, 'Clé de la vidéo', 256, 512);
  const noncePrefix = b64(body.noncePrefix, 'Préfixe', 8, 8);
  main()
    .prepare("UPDATE gallery_videos SET status = 'recording', wrapped_key = ?, nonce_prefix = ?, started_at = ?, last_chunk_at = ? WHERE id = ?")
    .run(wrappedKey, noncePrefix, new Date().toISOString(), new Date().toISOString(), v.id);
}

/**
 * Morceau n° `n` (déjà chiffré). Les envois répétés du même morceau (nouvel essai après une
 * coupure) sont acceptés. Renvoie `stop` si la console a demandé l'arrêt.
 */
export function deviceChunk(d: DeviceRow, id: unknown, n: number, data: Buffer, final: boolean, durationMs: number | null): { stop: boolean } {
  const v = deviceVideo(d, id);
  if (!Number.isInteger(n) || n < 0) throw new ValidationError('Numéro de morceau invalide.');
  if (data.length < 16 || data.length > MAX_CHUNK_BYTES) throw new ValidationError('Morceau de taille invalide.');
  const file = chunkFile(v.user_id, v.id, n);
  if (n < v.chunks) {
    // Déjà reçu (la réponse s'était perdue) : rien à refaire.
    return { stop: !!v.stop_requested };
  }
  if (v.status !== 'recording') throw new GalleryConflict('Cet enregistrement est terminé.');
  if (n !== v.chunks) throw new GalleryConflict(`Morceau ${v.chunks} attendu.`);
  if (v.bytes + data.length > MAX_VIDEO_BYTES || usedBytes(v.user_id) + data.length > quotaBytes()) {
    main().prepare("UPDATE gallery_videos SET status = 'error', error = ?, ended_at = ? WHERE id = ?").run('Galerie pleine : enregistrement arrêté.', new Date().toISOString(), v.id);
    throw new GalleryConflict('Galerie pleine.');
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
  const now = new Date().toISOString();
  const dur = durationMs !== null && Number.isFinite(durationMs) && durationMs >= 0 && durationMs < 24 * 3600_000 ? Math.round(durationMs) : null;
  main()
    .prepare(
      `UPDATE gallery_videos SET chunks = chunks + 1, bytes = bytes + ?, last_chunk_at = ?,
         duration_ms = COALESCE(?, duration_ms),
         status = CASE WHEN ? THEN 'done' ELSE status END,
         complete = CASE WHEN ? THEN 1 ELSE complete END,
         ended_at = CASE WHEN ? THEN ? ELSE ended_at END
       WHERE id = ?`,
    )
    .run(data.length, now, dur, final ? 1 : 0, final ? 1 : 0, final ? 1 : 0, now, v.id);
  return { stop: !!v.stop_requested };
}

/** L'écran n'a pas pu enregistrer (caméra, mémoire…) : la vidéo garde ce qui a été reçu. */
export function deviceFail(d: DeviceRow, id: unknown, message: unknown): void {
  const v = deviceVideo(d, id);
  if (v.status !== 'waiting' && v.status !== 'recording') return;
  const msg = typeof message === 'string' && message.trim() ? message.trim().slice(0, 200) : 'Erreur sur l’écran.';
  main().prepare("UPDATE gallery_videos SET status = ?, error = ?, ended_at = ? WHERE id = ?").run(v.chunks > 0 ? 'error' : 'cancelled', msg, new Date().toISOString(), v.id);
}
