import type { DB } from '../db.js';
import { config as appConfig } from '../config.js';
import { HttpError, fetchJson, fetchRaw } from '../http.js';
import { randomToken } from '../crypto.js';
import { imageUrlFor } from '../images.js';
import { str, type IntegrationContext, type IntegrationDef } from './types.js';

const SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'user-library-read',
  'user-library-modify',
].join(' ');

export function redirectUri(): string {
  return `${appConfig.publicUrl}/api/oauth/spotify/callback`;
}

// États OAuth en attente (anti-CSRF), valables 10 minutes.
const pendingStates = new Map<string, number>();

export function buildAuthorizeUrl(clientId: string): string {
  const state = randomToken(16);
  const now = Date.now();
  for (const [k, exp] of pendingStates) if (exp < now) pendingStates.delete(k);
  pendingStates.set(state, now + 10 * 60_000);
  const url = new URL('https://accounts.spotify.com/authorize');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('scope', SCOPES);
  url.searchParams.set('redirect_uri', redirectUri());
  url.searchParams.set('state', state);
  return url.toString();
}

export function consumeState(state: string): boolean {
  const exp = pendingStates.get(state);
  pendingStates.delete(state);
  return !!exp && exp > Date.now();
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

async function tokenRequest(ctx: IntegrationContext, params: URLSearchParams): Promise<TokenResponse> {
  const basic = Buffer.from(`${ctx.config.clientId}:${ctx.secrets.clientSecret}`).toString('base64');
  return fetchJson<TokenResponse>('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });
}

export async function exchangeCode(ctx: IntegrationContext, code: string): Promise<void> {
  const tok = await tokenRequest(ctx, new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri() }));
  ctx.saveSecrets({
    accessToken: tok.access_token,
    refreshToken: tok.refresh_token ?? ctx.secrets.refreshToken ?? null,
    accessExpiresAt: String(Date.now() + tok.expires_in * 1000),
  });
  const me = await api<SpotifyMe>(ctx, '/me');
  ctx.saveConfig({ account: me.display_name, product: me.product ?? '' });
}

// Depuis février 2026, `product` n'est plus renvoyé aux apps en « Development Mode »
// (dont le propriétaire doit de toute façon avoir Premium) : on ne l'affiche que s'il est connu.
interface SpotifyMe {
  display_name: string;
  product?: string;
}

async function accessToken(ctx: IntegrationContext): Promise<string> {
  const exp = Number(ctx.secrets.accessExpiresAt || 0);
  if (ctx.secrets.accessToken && exp - Date.now() > 60_000) return ctx.secrets.accessToken;
  if (!ctx.secrets.refreshToken) throw new Error('Compte Spotify non connecté.');
  const tok = await tokenRequest(ctx, new URLSearchParams({ grant_type: 'refresh_token', refresh_token: ctx.secrets.refreshToken }));
  ctx.saveSecrets({
    accessToken: tok.access_token,
    accessExpiresAt: String(Date.now() + tok.expires_in * 1000),
    ...(tok.refresh_token ? { refreshToken: tok.refresh_token } : {}),
  });
  return tok.access_token;
}

async function api<T>(ctx: IntegrationContext, path: string, method = 'GET', body?: unknown): Promise<T> {
  const token = await accessToken(ctx);
  const res = await fetchRaw(`https://api.spotify.com/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    timeoutMs: 10_000,
  });
  if (res.status === 204 || res.status === 202) return undefined as T;
  const text = await res.text();
  if (!res.ok) {
    let reason = '';
    try {
      reason = JSON.parse(text)?.error?.reason ?? JSON.parse(text)?.error?.message ?? '';
    } catch {
      /* corps non JSON */
    }
    if (reason === 'PREMIUM_REQUIRED') throw new HttpError(403, text, 'Spotify Premium est nécessaire pour contrôler la lecture.');
    if (reason === 'NO_ACTIVE_DEVICE') throw new HttpError(404, text, 'Aucun appareil Spotify actif : lance la lecture sur un appareil.');
    throw new HttpError(res.status, text, `Spotify a répondu ${res.status}${reason ? ` (${reason})` : ''}`);
  }
  return (text ? JSON.parse(text) : undefined) as T;
}

interface SpotifyImage {
  url: string;
  width: number | null;
}
interface SpotifyTrack {
  id: string;
  name: string;
  duration_ms: number;
  artists?: { name: string }[];
  album?: { name: string; images: SpotifyImage[] };
  show?: { name: string; images: SpotifyImage[] };
  images?: SpotifyImage[];
}
interface PlayerState {
  is_playing: boolean;
  progress_ms: number | null;
  device?: { name: string; volume_percent: number | null };
  item: SpotifyTrack | null;
}

export interface MusicState {
  available: boolean;
  isPlaying: boolean;
  deviceName: string;
  volume: number;
  liked: boolean;
  track: { id: string; title: string; artist: string; album: string; durationMs: number; progressMs: number; imageUrl: string } | null;
  queue: { title: string; artist: string; durationMs: number; imageUrl: string }[];
  message?: string;
}

function pickImage(t: SpotifyTrack, size: number): string {
  const imgs = t.album?.images ?? t.images ?? t.show?.images ?? [];
  const best = [...imgs].sort((a, b) => (a.width ?? 0) - (b.width ?? 0)).find((i) => (i.width ?? 0) >= size) ?? imgs[0];
  return best ? imageUrlFor(best.url, size, size) : '';
}

function trackArtist(t: SpotifyTrack): string {
  return t.artists?.map((a) => a.name).join(', ') ?? t.show?.name ?? '';
}

// Bibliothèque (« J'aime ») : nouveaux points d'accès /me/library (URI Spotify) depuis
// février 2026, avec repli sur les anciens /me/tracks pour les apps qui y ont encore droit.
async function isSaved(ctx: IntegrationContext, trackId: string): Promise<boolean> {
  const uri = encodeURIComponent(`spotify:track:${trackId}`);
  try {
    const r = await api<boolean[]>(ctx, `/me/library/contains?uris=${uri}`);
    return !!r?.[0];
  } catch {
    try {
      const r = await api<boolean[]>(ctx, `/me/tracks/contains?ids=${trackId}`);
      return !!r?.[0];
    } catch {
      return false;
    }
  }
}

async function setSaved(ctx: IntegrationContext, trackId: string, saved: boolean): Promise<void> {
  const method = saved ? 'PUT' : 'DELETE';
  try {
    await api(ctx, `/me/library?uris=${encodeURIComponent(`spotify:track:${trackId}`)}`, method);
  } catch (err) {
    if (err instanceof HttpError && (err.status === 404 || err.status === 410)) {
      await api(ctx, `/me/tracks?ids=${trackId}`, method);
      return;
    }
    throw err;
  }
}

let nowCache: { at: number; value: MusicState } | null = null;

export async function nowPlaying(ctx: IntegrationContext, fresh = false): Promise<MusicState> {
  if (!fresh && nowCache && Date.now() - nowCache.at < 4000) return nowCache.value;
  const player = await api<PlayerState | undefined>(ctx, '/me/player?additional_types=track,episode');
  let value: MusicState;
  if (!player || !player.item) {
    value = { available: true, isPlaying: false, deviceName: player?.device?.name ?? '', volume: player?.device?.volume_percent ?? 50, liked: false, track: null, queue: [] };
  } else {
    const t = player.item;
    let liked = false;
    let queue: MusicState['queue'] = [];
    try {
      const [contains, q] = await Promise.all([
        isSaved(ctx, t.id).then((v) => [v]),
        api<{ queue: SpotifyTrack[] }>(ctx, '/me/player/queue').catch(() => ({ queue: [] as SpotifyTrack[] })),
      ]);
      liked = !!contains?.[0];
      queue = (q?.queue ?? []).slice(0, 3).map((x) => ({ title: x.name, artist: trackArtist(x), durationMs: x.duration_ms, imageUrl: pickImage(x, 80) }));
    } catch {
      /* file d'attente optionnelle */
    }
    value = {
      available: true,
      isPlaying: player.is_playing,
      deviceName: player.device?.name ?? '',
      volume: player.device?.volume_percent ?? 50,
      liked,
      track: {
        id: t.id,
        title: t.name,
        artist: trackArtist(t),
        album: t.album?.name ?? t.show?.name ?? '',
        durationMs: t.duration_ms,
        progressMs: player.progress_ms ?? 0,
        imageUrl: pickImage(t, 420),
      },
      queue,
    };
  }
  nowCache = { at: Date.now(), value };
  return value;
}

export async function control(ctx: IntegrationContext, action: string, value?: unknown): Promise<MusicState> {
  const current = nowCache?.value;
  switch (action) {
    case 'play':
      await api(ctx, '/me/player/play', 'PUT');
      break;
    case 'pause':
      await api(ctx, '/me/player/pause', 'PUT');
      break;
    case 'next':
      await api(ctx, '/me/player/next', 'POST');
      break;
    case 'previous':
      await api(ctx, '/me/player/previous', 'POST');
      break;
    case 'volume': {
      const v = Math.max(0, Math.min(100, Math.round(Number(value))));
      if (!Number.isFinite(v)) throw new HttpError(400, '', 'Volume invalide.');
      await api(ctx, `/me/player/volume?volume_percent=${v}`, 'PUT');
      break;
    }
    case 'like': {
      const id = current?.track?.id;
      if (!id) throw new HttpError(409, '', 'Aucun titre en cours.');
      const like = value === undefined ? !current?.liked : !!value;
      await setSaved(ctx, id, like);
      break;
    }
    default:
      throw new HttpError(400, '', 'Action inconnue.');
  }
  // Spotify met un court instant à refléter la commande.
  await new Promise((r) => setTimeout(r, 350));
  return nowPlaying(ctx, true);
}

export const spotify: IntegrationDef = {
  id: 'spotify',
  name: 'Spotify',
  description: 'Lecture, file d’attente et commandes',
  defaults: { clientId: '', account: '', product: '' },
  secretFields: ['clientSecret'],
  fields: () => [
    { key: 'clientId', label: 'Client ID', type: 'text', mono: true, copyable: true, placeholder: 'Depuis developer.spotify.com' },
    { key: 'clientSecret', label: 'Client Secret', type: 'secret' },
    { key: 'redirectUri', label: 'URI de redirection (à copier dans ton app Spotify)', type: 'readonly', mono: true, copyable: true },
    { key: 'account', label: 'Compte connecté', type: 'readonly' },
  ],
  actions: (ctx) => [{ id: 'connect', label: ctx.secrets.refreshToken ? 'Reconnecter le compte' : 'Connecter le compte Spotify' }],
  missing(ctx) {
    if (!ctx.config.clientId || !ctx.secrets.clientSecret) return 'Renseigne le Client ID et le Client Secret de ton app Spotify.';
    if (!ctx.secrets.refreshToken) return 'Clique sur « Connecter le compte Spotify ».';
    return null;
  },
  // Simple vérification périodique du jeton ; la lecture en cours est lue à la demande.
  isDue: (_ctx, last, now) => !last || now.getTime() - last.getTime() >= 10 * 60_000,
  async run(ctx) {
    const me = await api<SpotifyMe>(ctx, '/me');
    const product = me.product ?? '';
    if (me.display_name !== ctx.config.account || product !== ctx.config.product) ctx.saveConfig({ account: me.display_name, product });
    if (product && product !== 'premium') return { status: 'warning', detail: `Connecté (${me.display_name}) · Premium requis pour les commandes` };
    return { status: 'ok', detail: `Connecté · ${me.display_name}${product === 'premium' ? ' · Premium' : ''}` };
  },
  async test(ctx) {
    const me = await api<SpotifyMe>(ctx, '/me');
    return `Compte ${me.display_name}${me.product ? ` (${me.product === 'premium' ? 'Premium' : me.product})` : ''}`;
  },
  sanitizeConfig(patch) {
    const out: Record<string, unknown> = {};
    if ('clientId' in patch) out.clientId = str(patch.clientId, 64);
    return out;
  },
  computed: (ctx) => ({ redirectUri: redirectUri(), account: ctx.config.account ? `${ctx.config.account}${ctx.config.product === 'premium' ? ' · Premium' : ''}` : 'Non connecté' }),
};

export type { DB };
