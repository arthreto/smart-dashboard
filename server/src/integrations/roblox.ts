import type { DB } from '../db.js';
import { getCache, setCache } from '../db.js';
import { fetchJson } from '../http.js';
import { ConfigError, num, str, type IntegrationDef } from './types.js';

interface GamesResponse {
  data: { id: number; rootPlaceId: number; name: string; playing: number; visits: number; favoritedCount: number }[];
}

export interface RobloxData {
  universeId: string;
  name: string;
  playing: number;
  visits: number;
  favorites: number;
  peak24h: number;
  deltaPct: number;
  history: number[];
  updatedAt: string;
}

async function fetchGame(universeId: string) {
  // API publique de Roblox : pas de clé nécessaire pour lire ces compteurs.
  const res = await fetchJson<GamesResponse>(`https://games.roblox.com/v1/games?universeIds=${encodeURIComponent(universeId)}`);
  const game = res.data?.[0];
  if (!game) throw new Error(`Aucune expérience trouvée pour l’ID ${universeId}`);
  return game;
}

export async function resolvePlaceId(placeId: string): Promise<{ universeId: string; name: string }> {
  if (!/^\d{1,20}$/.test(placeId)) throw new ConfigError('ID de place invalide.');
  const res = await fetchJson<{ universeId: number }>(`https://apis.roblox.com/universes/v1/places/${placeId}/universe`);
  if (!res?.universeId) throw new Error('Place introuvable.');
  const game = await fetchGame(String(res.universeId));
  return { universeId: String(res.universeId), name: game.name };
}

function summarize(db: DB, universeId: string, name: string, playing: number, visits: number, favorites: number): RobloxData {
  const now = Date.now();
  const dayAgo = now - 24 * 3600_000;
  const samples = db.prepare('SELECT ts, playing FROM roblox_samples WHERE ts >= ? ORDER BY ts').all(dayAgo - 3600_000) as {
    ts: number;
    playing: number;
  }[];
  // 24 points horaires (moyenne de chaque heure), le dernier = valeur actuelle.
  const history: number[] = [];
  for (let i = 23; i >= 0; i--) {
    const from = now - (i + 1) * 3600_000;
    const to = now - i * 3600_000;
    const inBucket = samples.filter((s) => s.ts > from && s.ts <= to);
    history.push(inBucket.length ? Math.round(inBucket.reduce((a, s) => a + s.playing, 0) / inBucket.length) : -1);
  }
  // Comble les trous (heures sans mesure) avec la valeur précédente connue.
  let last = history.find((v) => v >= 0) ?? playing;
  for (let i = 0; i < history.length; i++) {
    if (history[i] < 0) history[i] = last;
    else last = history[i];
  }
  history[history.length - 1] = playing;
  const recent = samples.filter((s) => s.ts >= dayAgo);
  const peak24h = Math.max(playing, ...recent.map((s) => s.playing));
  const old = samples.find((s) => s.ts >= dayAgo - 30 * 60_000);
  const deltaPct = old && old.playing > 0 && old.ts <= dayAgo + 30 * 60_000 ? Math.round(((playing - old.playing) / old.playing) * 100) : 0;
  return { universeId, name, playing, visits, favorites, peak24h, deltaPct, history, updatedAt: new Date().toISOString() };
}

export const roblox: IntegrationDef = {
  id: 'roblox',
  name: 'Roblox',
  description: 'Joueurs connectés de ton jeu',
  defaults: { universeId: '', intervalSeconds: 60, historyDays: 30 },
  secretFields: [],
  fields: () => [
    { key: 'universeId', label: 'ID de l’expérience (Universe ID)', type: 'text', mono: true, placeholder: '1234567890' },
    { key: 'gameName', label: 'Jeu', type: 'readonly' },
    {
      key: 'intervalSeconds',
      label: 'Fréquence de mise à jour',
      type: 'select',
      options: [
        { value: '30', label: 'Toutes les 30 secondes' },
        { value: '60', label: 'Toutes les minutes' },
        { value: '300', label: 'Toutes les 5 minutes' },
      ],
    },
    { key: 'historyDays', label: 'Historique conservé (jours)', type: 'number', min: 1, max: 365 },
  ],
  actions: () => [{ id: 'resolve', label: 'J’ai seulement l’ID de la place' }],
  missing: (ctx) => (ctx.config.universeId ? null : 'Indique l’ID de ton expérience Roblox.'),
  isDue: (ctx, last, now) => !last || now.getTime() - last.getTime() >= Number(ctx.config.intervalSeconds || 60) * 1000 - 2000,
  async run(ctx) {
    const game = await fetchGame(ctx.config.universeId);
    const ts = Date.now();
    ctx.db.prepare('INSERT OR REPLACE INTO roblox_samples (ts, playing) VALUES (?, ?)').run(ts, game.playing);
    ctx.db.prepare('DELETE FROM roblox_samples WHERE ts < ?').run(ts - Number(ctx.config.historyDays || 30) * 86400_000);
    const data = summarize(ctx.db, ctx.config.universeId, game.name, game.playing, game.visits, game.favoritedCount);
    setCache(ctx.db, 'roblox', data);
    if (ctx.config.gameName !== game.name) ctx.saveConfig({ gameName: game.name });
    const time = new Date().toTimeString().slice(0, 5);
    return { status: 'ok', detail: `${game.playing.toLocaleString('fr-FR')} joueurs · ${time}` };
  },
  async test(ctx) {
    const game = await fetchGame(ctx.config.universeId);
    return `${game.name} · ${game.playing.toLocaleString('fr-FR')} joueurs en ligne`;
  },
  sanitizeConfig(patch) {
    const out: Record<string, unknown> = {};
    if ('universeId' in patch) {
      const v = str(patch.universeId, 20);
      if (v && !/^\d+$/.test(v)) throw new ConfigError('L’ID de l’expérience ne contient que des chiffres.');
      out.universeId = v;
      out.gameName = '';
    }
    if ('intervalSeconds' in patch) {
      const v = Number(patch.intervalSeconds);
      if (![30, 60, 300].includes(v)) throw new ConfigError('Intervalle invalide.');
      out.intervalSeconds = v;
    }
    if ('historyDays' in patch) out.historyDays = Math.round(num(patch.historyDays, 1, 365, 'L’historique'));
    return out;
  },
};

export function robloxForDevice(db: DB): Omit<RobloxData, 'universeId' | 'updatedAt'> | null {
  const data = getCache<RobloxData>(db, 'roblox')?.value;
  if (!data) return null;
  const { universeId: _u, updatedAt: _t, ...rest } = data;
  return rest;
}
