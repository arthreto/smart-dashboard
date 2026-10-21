// Galerie déverrouillée : la clé privée reste en mémoire dans cet onglet seulement
// (jamais stockée), et se reverrouille après 15 minutes sans activité dans la galerie.
import { ApiError, api } from '../api';
import { decryptChunk, openVideoKey, type VideoKey } from './crypto';
import { parseStream, posterFrom, toMp4 } from './media';

export interface GalleryVideo {
  id: string;
  deviceId: number;
  deviceName: string;
  status: 'waiting' | 'recording' | 'done' | 'error' | 'cancelled';
  stopRequested: boolean;
  error: string | null;
  chunks: number;
  bytes: number;
  complete: boolean;
  durationMs: number | null;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
}

interface VideoMeta extends GalleryVideo {
  wrappedKey: string | null;
  noncePrefix: string | null;
}

const IDLE_LOCK_MS = 15 * 60_000;

let privateKey: CryptoKey | null = null;
let lastUse = 0;
const listeners = new Set<() => void>();
const posters = new Map<string, string>();
const videoKeys = new Map<string, VideoKey>();

export function isUnlocked(): boolean {
  if (privateKey && Date.now() - lastUse > IDLE_LOCK_MS) lock();
  return !!privateKey;
}

export function setUnlocked(key: CryptoKey): void {
  privateKey = key;
  touch();
  listeners.forEach((fn) => fn());
}

export function touch(): void {
  lastUse = Date.now();
}

export function lock(): void {
  privateKey = null;
  posters.clear();
  videoKeys.clear();
  listeners.forEach((fn) => fn());
}

export function onLockChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function requireKey(): CryptoKey {
  if (!isUnlocked() || !privateKey) throw new Error('Galerie verrouillée : saisis ton code.');
  touch();
  return privateKey;
}

async function videoKey(id: string): Promise<{ meta: VideoMeta; vk: VideoKey }> {
  const meta = await api.get<VideoMeta>(`/api/gallery/videos/${id}`);
  if (!meta.wrappedKey || !meta.noncePrefix || meta.chunks === 0) throw new Error('Cette vidéo ne contient encore aucune image.');
  let vk = videoKeys.get(id);
  if (!vk) {
    try {
      vk = await openVideoKey(requireKey(), meta.wrappedKey, meta.noncePrefix);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Galerie verrouillée')) throw err;
      throw new Error('Clé de la vidéo illisible : elle a été chiffrée pour une autre clé (galerie réinitialisée ?).');
    }
    videoKeys.set(id, vk);
  }
  return { meta, vk };
}

async function fetchChunk(id: string, n: number, signal?: AbortSignal): Promise<ArrayBuffer> {
  let res: Response;
  try {
    res = await fetch(`/api/gallery/videos/${id}/chunks/${n}`, { credentials: 'same-origin', signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError(0, 'network', 'Impossible de joindre le serveur.');
  }
  if (!res.ok) throw new ApiError(res.status, 'chunk', `Morceau ${n} introuvable (${res.status}).`);
  return res.arrayBuffer();
}

/** Déchiffre toute la vidéo et en fait un MP4. `onProgress` reçoit 0..1. */
export async function loadVideo(id: string, onProgress?: (p: number) => void, signal?: AbortSignal): Promise<{ mp4: Uint8Array; durationMs: number }> {
  const { meta, vk } = await videoKey(id);
  const parts: Uint8Array[] = new Array(meta.chunks);
  // Récupération et déchiffrement en parallèle (la latence réseau domine) : nettement plus
  // rapide que morceau par morceau. Chaque morceau est indépendant ; on les range dans l'ordre.
  const CONCURRENCY = 6;
  let next = 0;
  let done = 0;
  const worker = async () => {
    for (;;) {
      const n = next++;
      if (n >= meta.chunks) return;
      const data = await fetchChunk(id, n, signal);
      const final = meta.complete && n === meta.chunks - 1;
      parts[n] = await decryptChunk(vk, id, n, final, data);
      done++;
      onProgress?.(done / meta.chunks);
      touch();
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, meta.chunks) }, worker));
  let total = 0;
  for (const p of parts) total += p.length;
  const stream = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    stream.set(p, o);
    o += p.length;
  }
  const { head, packets } = parseStream(stream);
  return toMp4(head, packets);
}

/** Vignette tirée du premier morceau seulement (mise en cache pour la session). */
export async function loadPoster(id: string): Promise<string> {
  const cached = posters.get(id);
  if (cached) return cached;
  const { meta, vk } = await videoKey(id);
  const data = await fetchChunk(id, 0);
  const plain = await decryptChunk(vk, id, 0, meta.complete && meta.chunks === 1, data);
  const { head, packets } = parseStream(plain);
  const { mp4 } = toMp4(head, packets, 12);
  const url = await posterFrom(mp4);
  posters.set(id, url);
  return url;
}

export function fileName(v: GalleryVideo): string {
  const d = new Date(v.startedAt ?? v.createdAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  const slug = v.deviceName.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'ecran';
  return `video-${slug}-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}h${pad(d.getMinutes())}.mp4`;
}
