// Programme Pathé via les points d'accès JSON publics que le site pathe.fr utilise lui-même.
// Non officiel : Pathé peut les modifier ou les bloquer à tout moment (l'intégration passe
// alors en erreur, sans impact sur le reste du tableau de bord).
import type { DB } from '../db.js';
import { getCache, setCache } from '../db.js';
import { addDays, dateKey, formatDuration, parseDateKey, WEEKDAY_SHORT, weekdayIndex } from '../dates.js';
import { logEvent } from '../events.js';
import { HttpError, fetchJson, mapLimit } from '../http.js';
import { imageUrlFor } from '../images.js';
import { householdIdOf, mainOrNull } from '../households.js';
import { ConfigError, str, type IntegrationDef } from './types.js';

const BASE = 'https://www.pathe.fr/api';
const CONCURRENCY = 4;

async function pget<T>(action: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${BASE}/${action}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  try {
    return await fetchJson<T>(url.toString(), { timeoutMs: 15_000 });
  } catch (err) {
    if (err instanceof HttpError && err.status === 403) throw new HttpError(403, err.body, 'Pathé a refusé la requête (403)');
    throw err;
  }
}

interface CatalogShow {
  slug: string;
  next24ShowtimesCount?: number;
  title?: string;
  releaseAt?: Record<string, string>;
}
interface Session {
  time: string;
  version?: string;
}
interface ShowDetails {
  slug: string;
  title: string;
  releaseAt?: Record<string, string>;
  posterPath?: { lg?: string; md?: string; sm?: string };
  genres?: unknown;
  duration?: number;
  runtime?: number;
  contentRating?: unknown;
  certification?: string;
  synopsis?: unknown;
  shortSynopsis?: unknown;
  directors?: unknown;
  actors?: unknown;
  trailers?: unknown;
  originalTitle?: string;
  nationality?: unknown;
}

/** Fiche détaillée d'un film (envoyée à l'écran à la demande). */
export interface FilmInfo {
  synopsis: string;
  directors: string;
  actors: string;
  trailerUrl: string;
  pageUrl: string;
  releaseDate: string;
  posterLargeUrl: string;
}

export interface CinemaFilm {
  id: string;
  title: string;
  genre: string;
  duration: string;
  rating: string;
  isNew: boolean;
  releaseDate: string;
  posterUrl: string;
  showsByDay: Record<string, { time: string; tag: string }[]>;
  info?: FilmInfo;
}

export interface CinemaData {
  cinemaId: string;
  cinemaName: string;
  days: { date: string; label: string }[];
  films: CinemaFilm[];
  upcoming: { id: string; title: string; date: string; genre: string; posterUrl: string; info?: FilmInfo }[];
  updatedAt: string;
}

function genreOf(d: ShowDetails): string {
  const g = d.genres;
  if (Array.isArray(g) && g.length) {
    const first = g[0] as unknown;
    if (typeof first === 'string') return first;
    if (first && typeof first === 'object' && 'name' in first) return String((first as { name: unknown }).name);
  }
  return '';
}

function ratingOf(d: ShowDetails): string {
  if (typeof d.certification === 'string') return d.certification;
  const r = d.contentRating as { label?: string; name?: string } | string | undefined;
  if (typeof r === 'string') return r;
  return r?.label ?? r?.name ?? '';
}

function posterOf(d: ShowDetails, w: number, h: number): string {
  const src = d.posterPath?.md || d.posterPath?.lg || d.posterPath?.sm;
  return src ? imageUrlFor(src, w, h) : '';
}

function textOf(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&rsquo;/g, '’')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** « Réalisateur », « Acteurs » : chaîne, liste de chaînes ou liste d'objets selon les fiches. */
function namesOf(v: unknown, max = 4): string {
  const list = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/,\s*/) : [];
  const names = list
    .map((x) => {
      if (typeof x === 'string') return x.trim();
      if (x && typeof x === 'object') {
        const o = x as Record<string, unknown>;
        const n = o.name ?? o.fullName ?? o.fullname ?? [o.firstName ?? o.firstname, o.lastName ?? o.lastname].filter(Boolean).join(' ');
        return typeof n === 'string' ? n.trim() : '';
      }
      return '';
    })
    .filter(Boolean);
  return names.slice(0, max).join(', ');
}

/** Lien de la bande-annonce (YouTube ou vidéo Pathé), sinon chaîne vide. */
function trailerOf(v: unknown): string {
  const items = Array.isArray(v) ? v : v ? [v] : [];
  for (const it of items) {
    if (typeof it === 'string') {
      if (/^https?:\/\//.test(it)) return it;
      if (/^[\w-]{11}$/.test(it)) return `https://www.youtube.com/watch?v=${it}`;
      continue;
    }
    if (!it || typeof it !== 'object') continue;
    const o = it as Record<string, unknown>;
    for (const k of ['url', 'link', 'src', 'externalUrl', 'videoUrl', 'href']) {
      const u = o[k];
      if (typeof u === 'string' && /^https?:\/\//.test(u)) return u;
    }
    const id = o.externalId ?? o.youtubeId ?? o.videoId ?? o.key ?? o.id;
    const provider = String(o.source ?? o.provider ?? o.platform ?? o.type ?? 'youtube').toLowerCase();
    if (typeof id === 'string' && /^[\w-]{11}$/.test(id) && provider.includes('youtube')) return `https://www.youtube.com/watch?v=${id}`;
    if (typeof id === 'string' && /^[\w-]{11}$/.test(id) && !provider.includes('vimeo')) return `https://www.youtube.com/watch?v=${id}`;
    if (typeof id === 'string' && /^\d+$/.test(id) && provider.includes('vimeo')) return `https://vimeo.com/${id}`;
  }
  return '';
}

function infoOf(d: ShowDetails): FilmInfo {
  return {
    synopsis: (textOf(d.synopsis) || textOf(d.shortSynopsis)).slice(0, 1200),
    directors: namesOf(d.directors, 3),
    actors: namesOf(d.actors, 5),
    trailerUrl: trailerOf(d.trailers),
    pageUrl: `https://www.pathe.fr/films/${encodeURIComponent(d.slug)}`,
    releaseDate: d.releaseAt?.FR_FR ?? '',
    posterLargeUrl: posterOf(d, 240, 350),
  };
}

function dayLabel(date: string, today: string): string {
  if (date === today) return 'Aujourd’hui';
  const d = parseDateKey(date);
  return `${WEEKDAY_SHORT[weekdayIndex(date)]}. ${d.getDate()}`;
}

async function sessionsFor(slug: string, cinemaId: string, date: string): Promise<{ time: string; tag: string }[]> {
  try {
    const sessions = await pget<Session[]>(`show/${slug}/showtimes/${cinemaId}/${date}`, { language: 'fr' });
    if (!Array.isArray(sessions)) return [];
    return sessions
      .filter((s) => typeof s.time === 'string')
      .map((s) => ({ time: s.time.slice(11, 16), tag: (s.version ?? '').toUpperCase() || 'VF' }))
      .sort((a, b) => a.time.localeCompare(b.time));
  } catch {
    return [];
  }
}

export async function fetchCinema(cinemaId: string, cinemaName: string, dayCount = 4): Promise<CinemaData> {
  const today = dateKey();
  const dates = Array.from({ length: dayCount }, (_, i) => addDays(today, i));
  const catalog = await pget<{ shows: CatalogShow[] }>('shows', { date: today, language: 'fr' });
  const shows = Array.isArray(catalog?.shows) ? catalog.shows : [];
  const candidates = shows.filter((s) => (s.next24ShowtimesCount ?? 0) > 0).slice(0, 300);

  // 1) Quels films passent dans ce cinéma aujourd'hui ou demain ?
  const todaySessions = await mapLimit(candidates, CONCURRENCY, (s) => sessionsFor(s.slug, cinemaId, today));
  const tomorrow = dates[1];
  const tomorrowSessions = tomorrow
    ? await mapLimit(candidates, CONCURRENCY, (s, i): Promise<{ time: string; tag: string }[]> =>
        todaySessions[i].length ? Promise.resolve([]) : sessionsFor(s.slug, cinemaId, tomorrow),
      )
    : candidates.map((): { time: string; tag: string }[] => []);
  const playing = candidates
    .map((s, i) => ({ slug: s.slug, today: todaySessions[i], tomorrow: tomorrowSessions[i] }))
    .filter((x) => x.today.length > 0 || x.tomorrow.length > 0);

  // 2) Séances des jours suivants pour ces films, puis leurs fiches.
  const films = await mapLimit(playing, CONCURRENCY, async (p) => {
    const showsByDay: CinemaFilm['showsByDay'] = { [today]: p.today };
    for (const d of dates.slice(1)) showsByDay[d] = d === tomorrow && p.tomorrow.length ? p.tomorrow : await sessionsFor(p.slug, cinemaId, d);
    let details: ShowDetails | null = null;
    try {
      details = await pget<ShowDetails>(`show/${p.slug}`, { language: 'fr' });
    } catch {
      details = null;
    }
    if (!details?.title) return null;
    const release = details.releaseAt?.FR_FR ?? '';
    const minutes = Number(details.duration ?? details.runtime ?? 0);
    return {
      id: p.slug,
      title: details.title,
      genre: genreOf(details),
      duration: formatDuration(minutes > 400 ? Math.round(minutes / 60) : minutes),
      rating: ratingOf(details),
      isNew: !!release && release <= today && release >= addDays(today, -7),
      releaseDate: release,
      posterUrl: posterOf(details, 176, 256),
      showsByDay,
      info: infoOf(details),
    } satisfies CinemaFilm;
  });

  // 3) Prochaines sorties nationales.
  const future = shows.filter((s) => (s.next24ShowtimesCount ?? 0) === 0).slice(0, 30);
  const upcomingDetails = await mapLimit(future, CONCURRENCY, async (s) => {
    try {
      return await pget<ShowDetails>(`show/${s.slug}`, { language: 'fr' });
    } catch {
      return null;
    }
  });
  const upcoming = upcomingDetails
    .filter((d): d is ShowDetails => !!d?.title && !!d.releaseAt?.FR_FR && d.releaseAt.FR_FR > today)
    .sort((a, b) => a.releaseAt!.FR_FR.localeCompare(b.releaseAt!.FR_FR))
    .slice(0, 12)
    .map((d) => ({ id: d.slug, title: d.title, date: d.releaseAt!.FR_FR, genre: genreOf(d), posterUrl: posterOf(d, 54, 80), info: infoOf(d) }));

  return {
    cinemaId,
    cinemaName,
    days: dates.map((d) => ({ date: d, label: dayLabel(d, today) })),
    // Nouveautés d'abord, puis les films les plus programmés.
    films: films
      .filter((f): f is NonNullable<typeof f> => !!f)
      .sort((a, b) => Number(b.isNew) - Number(a.isNew) || (b.showsByDay[today]?.length ?? 0) - (a.showsByDay[today]?.length ?? 0)),
    upcoming,
    updatedAt: new Date().toISOString(),
  };
}

export async function listCinemas(db: DB): Promise<{ id: string; name: string; city: string }[]> {
  const cached = getCache<{ id: string; name: string; city: string }[]>(db, 'pathe_cinemas');
  if (cached && Date.now() - new Date(cached.fetchedAt).getTime() < 7 * 86400_000) return cached.value;
  const raw = await pget<{ slug: string; name: string; theaters?: { addressCity?: string }[] }[]>('cinemas', { language: 'fr' });
  const list = (Array.isArray(raw) ? raw : [])
    .filter((c) => c?.slug && c?.name)
    .map((c) => ({ id: c.slug, name: c.name, city: c.theaters?.[0]?.addressCity ?? '' }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  setCache(db, 'pathe_cinemas', list);
  return list;
}

/** Prévient sur la tablette quand un film suivi arrive à l'affiche. */
function processAlerts(db: DB, data: CinemaData): void {
  const alerts = db.prepare('SELECT film_id, title FROM cinema_alerts WHERE notified = 0').all() as { film_id: string; title: string }[];
  for (const a of alerts) {
    const film = data.films.find((f) => f.id === a.film_id);
    if (!film) continue;
    const text = `« ${film.title} » est à l’affiche au ${data.cinemaName}`;
    // Message sur chacun des écrans du foyer.
    const devices = (mainOrNull()?.prepare('SELECT id FROM devices WHERE household_id = ?').all(householdIdOf(db)) ?? []) as { id: number }[];
    const ins = db.prepare('INSERT INTO commands (type, text, created_at, device_id) VALUES (?, ?, ?, ?)');
    for (const d of devices) ins.run('message', text, new Date().toISOString(), d.id);
    db.prepare('UPDATE cinema_alerts SET notified = 1 WHERE film_id = ?').run(a.film_id);
    logEvent(db, 'pathe', 'info', text);
  }
}

export const pathe: IntegrationDef = {
  id: 'pathe',
  name: 'Pathé',
  description: 'Films à l’affiche, affiches et séances',
  defaults: { cinemaId: '', cinemaName: '', fetchTimes: ['07:30', '13:30'] },
  secretFields: [],
  fields: () => [
    { key: 'cinemaId', label: 'Cinéma', type: 'select', help: 'Liste chargée depuis pathe.fr' },
    { key: 'fetchTimes', label: 'Récupération du programme', type: 'time-list' },
    { key: 'source', label: 'Source', type: 'readonly' },
    { key: 'alerts', label: 'Alertes de sortie', type: 'chips' },
  ],
  missing: (ctx) => (ctx.config.cinemaId ? null : 'Choisis ton cinéma Pathé.'),
  isDue(ctx, last, now) {
    if (!last) return true;
    const times: string[] = Array.isArray(ctx.config.fetchTimes) && ctx.config.fetchTimes.length ? ctx.config.fetchTimes : ['07:30'];
    const today = dateKey(now);
    // Nouvelle journée : le programme d'hier n'est plus valable.
    if (dateKey(last) !== today && now.getHours() >= 6) return true;
    return times.some((t) => {
      const [h, m] = t.split(':').map(Number);
      const at = new Date(now);
      at.setHours(h, m, 0, 0);
      return now >= at && last < at;
    });
  },
  async run(ctx) {
    const data = await fetchCinema(ctx.config.cinemaId, ctx.config.cinemaName || ctx.config.cinemaId);
    setCache(ctx.db, 'pathe', data);
    processAlerts(ctx.db, data);
    const time = new Date().toTimeString().slice(0, 5);
    if (data.films.length === 0) return { status: 'warning', detail: `Aucune séance trouvée aujourd’hui · ${time}` };
    return { status: 'ok', detail: `${data.films.length} films à l’affiche · ${time}` };
  },
  async test(ctx) {
    const today = dateKey();
    const catalog = await pget<{ shows: CatalogShow[] }>('shows', { date: today, language: 'fr' });
    return `Catalogue accessible · ${catalog?.shows?.length ?? 0} films en France`;
  },
  sanitizeConfig(patch) {
    const out: Record<string, unknown> = {};
    if ('cinemaId' in patch) {
      const v = str(patch.cinemaId, 80);
      if (v && !/^[a-z0-9-]+$/.test(v)) throw new ConfigError('Identifiant de cinéma invalide.');
      out.cinemaId = v;
    }
    if ('cinemaName' in patch) out.cinemaName = str(patch.cinemaName, 80);
    if ('fetchTimes' in patch) {
      const list = patch.fetchTimes;
      if (!Array.isArray(list) || list.length < 1 || list.length > 4 || !list.every((t) => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t))) {
        throw new ConfigError('Heures de récupération invalides (1 à 4 heures HH:MM).');
      }
      out.fetchTimes = [...new Set(list)].sort();
    }
    return out;
  },
  computed(ctx) {
    const alerts = ctx.db.prepare('SELECT title FROM cinema_alerts WHERE notified = 0 ORDER BY created_at').all() as { title: string }[];
    return { source: 'Programme public pathe.fr · non officiel', alerts: alerts.map((a) => a.title) };
  },
};

export function cinemaForDevice(db: DB) {
  const data = getCache<CinemaData>(db, 'pathe')?.value;
  if (!data) return null;
  const notify = new Set((db.prepare('SELECT film_id FROM cinema_alerts').all() as { film_id: string }[]).map((r) => r.film_id));
  const today = dateKey();
  const days = data.days.filter((d) => d.date >= today).map((d) => ({ ...d, label: dayLabel(d.date, today) }));
  const now = new Date();
  const nowHm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  return {
    cinemaName: data.cinemaName,
    days,
    films: data.films.map((f) => ({
      id: f.id,
      title: f.title,
      genre: f.genre,
      duration: f.duration,
      rating: f.rating,
      isNew: f.isNew,
      posterUrl: f.posterUrl,
      shows: (f.showsByDay[today] ?? []).filter((s) => s.time >= nowHm),
      showsByDay: days.map((d) => (d.date === today ? (f.showsByDay[d.date] ?? []).filter((s) => s.time >= nowHm) : f.showsByDay[d.date] ?? [])),
    })),
    upcoming: data.upcoming.filter((u) => u.date > today).map((u) => ({ ...u, notify: notify.has(u.id) })),
  };
}

/** Fiche d'un film à l'affiche ou à venir (cache du foyer). */
export function filmDetails(db: DB, id: string) {
  const data = getCache<CinemaData>(db, 'pathe')?.value;
  if (!data) return null;
  const film = data.films.find((f) => f.id === id);
  const up = data.upcoming.find((u) => u.id === id);
  const src = film ?? up;
  if (!src) return null;
  const info: FilmInfo = src.info ?? { synopsis: '', directors: '', actors: '', trailerUrl: '', pageUrl: `https://www.pathe.fr/films/${id}`, releaseDate: '', posterLargeUrl: '' };
  return {
    id,
    title: src.title,
    genre: src.genre,
    duration: film?.duration ?? '',
    rating: film?.rating ?? '',
    releaseDate: info.releaseDate || (up?.date ?? ''),
    synopsis: info.synopsis,
    directors: info.directors,
    actors: info.actors,
    // Sans lien direct : la page du film sur pathe.fr, qui contient la bande-annonce.
    trailerUrl: info.trailerUrl || info.pageUrl,
    trailerIsPage: !info.trailerUrl,
    posterUrl: info.posterLargeUrl || src.posterUrl,
  };
}

export function setCinemaAlert(db: DB, filmId: string, notify: boolean): void {
  if (!/^[a-z0-9-]{1,120}$/.test(filmId)) throw new ConfigError('Film inconnu.');
  if (notify) {
    const title = getCache<CinemaData>(db, 'pathe')?.value.upcoming.find((u) => u.id === filmId)?.title ?? filmId;
    db.prepare('INSERT OR IGNORE INTO cinema_alerts (film_id, title, created_at) VALUES (?, ?, ?)').run(filmId, title, new Date().toISOString());
  } else {
    db.prepare('DELETE FROM cinema_alerts WHERE film_id = ?').run(filmId);
  }
}
