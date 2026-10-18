import ical from 'node-ical';
import { createDAVClient, type DAVCalendar } from 'tsdav';
import type { DB } from '../db.js';
import { getCache, setCache } from '../db.js';
import { addDays, dateKey, hhmm, mondayOf } from '../dates.js';
import { ConfigError, str, type IntegrationContext, type IntegrationDef } from './types.js';

export interface AgendaEvent {
  id: string;
  date: string;
  start: string;
  end: string;
  startTs: number;
  /** Fin (horodatage) ; absente dans les caches d'avant cette version. */
  endTs?: number;
  /** Jour de fin : exclusif pour un événement « journée entière ». */
  endDate?: string;
  title: string;
  location: string;
  calendar: string;
  color: string;
  allDay: boolean;
  important: boolean;
  reminderMinutes: number | null;
}

export interface AgendaData {
  events: AgendaEvent[];
  calendars: { id: string; name: string; color: string }[];
  updatedAt: string;
  /** Période couverte (jours AAAA-MM-JJ, fin exclue). */
  rangeFrom?: string;
  rangeTo?: string;
}

const PALETTE = ['#30D158', '#0A84FF', '#FF9F0A', '#FF453A', '#BF5AF2', '#64D2FF', '#FF375F', '#5E5CE6'];

function normColor(c: unknown, i: number): string {
  if (typeof c === 'string') {
    const m = /^#?([0-9a-fA-F]{6})/.exec(c.trim());
    if (m) return `#${m[1].toUpperCase()}`;
  }
  return PALETTE[i % PALETTE.length];
}

function calName(c: DAVCalendar): string {
  const d = c.displayName as unknown;
  if (typeof d === 'string') return d;
  if (d && typeof d === 'object' && '_cdata' in d) return String((d as { _cdata: unknown })._cdata);
  return 'Calendrier';
}

/** Le mot de passe pour app est souvent recopié avec des espaces ou un retour à la ligne. */
export function normalizeAppleCredentials(appleId: unknown, appPassword: unknown): { username: string; password: string } {
  return {
    username: String(appleId ?? '').trim().toLowerCase(),
    password: String(appPassword ?? '').replace(/\s+/g, ''),
  };
}

async function client(ctx: IntegrationContext) {
  try {
    return await createDAVClient({
      serverUrl: 'https://caldav.icloud.com',
      credentials: normalizeAppleCredentials(ctx.config.appleId, ctx.secrets.appPassword),
      authMethod: 'Basic',
      defaultAccountType: 'caldav',
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/401|Invalid credentials|Unauthorized/i.test(msg)) {
      throw new ConfigError(
        'Apple refuse la connexion (401). Vérifie : 1) l’identifiant est l’adresse principale de ton compte Apple ' +
          '(Réglages de l’iPhone › ton nom, sous la photo) ; 2) le mot de passe est un « mot de passe pour app » ' +
          '(account.apple.com › Connexion et sécurité), pas ton mot de passe Apple ; 3) il n’a pas été révoqué. ' +
          'Si ça échoue encore, crée un nouveau mot de passe pour app et colle-le à nouveau.',
      );
    }
    throw e;
  }
}

export async function listCalendars(ctx: IntegrationContext): Promise<{ id: string; name: string; color: string }[]> {
  const c = await client(ctx);
  const cals = await c.fetchCalendars();
  return cals
    .filter((cal) => !cal.components || cal.components.includes('VEVENT'))
    .map((cal, i) => ({ id: cal.url, name: calName(cal), color: normColor(cal.calendarColor, i) }));
}

/** Minutes avant l'événement du premier rappel (TRIGGER:-PT15M → 15). */
function reminderOf(ev: ical.VEvent): number | null {
  const trig = ev.alarms?.[0]?.trigger as unknown;
  const s = typeof trig === 'string' ? trig : trig && typeof trig === 'object' && 'val' in trig ? String((trig as { val: unknown }).val) : '';
  const m = /^-?P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/.exec(s);
  if (!m || !s.startsWith('-')) return null;
  return Number(m[1] ?? 0) * 1440 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

function pushOccurrence(out: AgendaEvent[], ev: ical.VEvent, start: Date, end: Date, cal: { name: string; color: string }, uidSuffix: string) {
  const allDay = (ev.datetype as string) === 'date';
  const priority = Number((ev as unknown as { priority?: string }).priority ?? 0);
  out.push({
    id: `${ev.uid}${uidSuffix}`,
    date: dateKey(start),
    start: allDay ? '' : hhmm(start),
    end: allDay ? '' : hhmm(end),
    startTs: start.getTime(),
    endTs: end.getTime(),
    endDate: dateKey(end),
    title: (typeof ev.summary === 'string' ? ev.summary : String((ev.summary as unknown as { val?: string })?.val ?? '')) || 'Sans titre',
    location: typeof ev.location === 'string' ? ev.location : '',
    calendar: cal.name,
    color: cal.color,
    allDay,
    important: priority > 0 && priority <= 4,
    reminderMinutes: reminderOf(ev),
  });
}

/** Décalage (ms) du fuseau `tz` à l'instant `ts` : heure locale − UTC. */
function tzOffset(ts: number, tz: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(new Date(ts));
    const v = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    return Date.UTC(v('year'), v('month') - 1, v('day'), v('hour'), v('minute'), v('second')) - ts;
  } catch {
    return -new Date(ts).getTimezoneOffset() * 60_000;
  }
}

/**
 * Les occurrences d'une règle de répétition avec fuseau (TZID) sont rendues « flottantes » :
 * leurs champs UTC portent l'heure locale (9 h → 09:00Z). On les replace dans leur fuseau,
 * sinon un rendez-vous de 9 h s'affiche à 11 h l'été et à 10 h l'hiver.
 */
export function floatingToDate(occ: Date, tz: string | undefined): Date {
  if (!tz) return occ;
  const wall = occ.getTime();
  let ts = wall - tzOffset(wall, tz);
  ts = wall - tzOffset(ts, tz); // second passage : changement d'heure
  return new Date(ts);
}

function expandEvent(out: AgendaEvent[], ev: ical.VEvent, from: Date, to: Date, cal: { name: string; color: string }) {
  if (!ev.start) return;
  const start = new Date(ev.start);
  const duration = (ev.end ? new Date(ev.end).getTime() : start.getTime() + 3600_000) - start.getTime();
  if (!ev.rrule) {
    if (start < to && start.getTime() + duration > from.getTime()) pushOccurrence(out, ev, start, new Date(start.getTime() + duration), cal, '');
    return;
  }
  const tz = (ev.rrule.origOptions as { tzid?: string | null }).tzid ?? undefined;
  const allDay = (ev.datetype as string) === 'date';
  const exdates = new Set<string>();
  for (const d of Object.values((ev.exdate ?? {}) as Record<string, Date>)) {
    exdates.add(dateKey(new Date(d)));
    exdates.add(new Date(d).toISOString().slice(0, 10));
  }
  // Marge d'un jour : les bornes sont comparées à des heures « flottantes ».
  for (const raw of ev.rrule.between(new Date(from.getTime() - duration - 86_400_000), new Date(to.getTime() + 86_400_000), true)) {
    // Journée entière : la date seule compte (champs UTC de l'occurrence).
    const occ = allDay
      ? new Date(raw.getUTCFullYear(), raw.getUTCMonth(), raw.getUTCDate())
      : floatingToDate(raw, tz);
    if (occ >= to || occ.getTime() + duration <= from.getTime()) continue;
    const day = dateKey(occ);
    if (exdates.has(day)) continue;
    const override = ev.recurrences?.[day] ?? ev.recurrences?.[raw.toISOString().slice(0, 10)];
    if (override) {
      if (override.start) {
        const os = new Date(override.start);
        const oe = override.end ? new Date(override.end) : new Date(os.getTime() + duration);
        pushOccurrence(out, override as ical.VEvent, os, oe, cal, `:${day}`);
      }
      continue;
    }
    pushOccurrence(out, ev, occ, new Date(occ.getTime() + duration), cal, `:${day}`);
  }
}

/** Événements d'un objet iCalendar entre `from` et `to` (répétitions développées). */
export function eventsFromIcs(out: AgendaEvent[], data: string, from: Date, to: Date, cal: { name: string; color: string }): void {
  let parsed: ical.CalendarResponse;
  try {
    parsed = ical.sync.parseICS(data);
  } catch {
    return;
  }
  for (const comp of Object.values(parsed)) {
    if (comp && (comp as { type?: string }).type === 'VEVENT') expandEvent(out, comp as ical.VEvent, from, to, cal);
  }
}

async function fetchAgenda(ctx: IntegrationContext, range?: { from: string; to: string }): Promise<AgendaData> {
  const c = await client(ctx);
  const all = await c.fetchCalendars();
  const wanted: string[] = Array.isArray(ctx.config.calendars) ? ctx.config.calendars : [];
  const cals = all
    .map((cal, i) => ({ cal, id: cal.url, name: calName(cal), color: normColor(cal.calendarColor, i) }))
    .filter((x) => (!x.cal.components || x.cal.components.includes('VEVENT')) && (wanted.length === 0 || wanted.includes(x.id)));

  // Par défaut : du début du mois précédent à trois mois devant (ce que l'écran affiche
  // le plus souvent) ; au-delà, l'écran demande la période voulue (agendaRange).
  const today = dateKey();
  const prevMonth = addDays(today.slice(0, 8) + '01', -1).slice(0, 8) + '01';
  const fromKey = range?.from ?? prevMonth;
  const toKey = range?.to ?? addDays(today, 92);
  const from = new Date(`${fromKey}T00:00:00`);
  const to = new Date(`${toKey}T00:00:00`);

  const events: AgendaEvent[] = [];
  for (const x of cals) {
    const objects = await c.fetchCalendarObjects({
      calendar: x.cal,
      timeRange: { start: from.toISOString(), end: to.toISOString() },
    });
    for (const obj of objects) {
      if (typeof obj.data === 'string') eventsFromIcs(events, obj.data, from, to, x);
    }
  }
  events.sort((a, b) => a.startTs - b.startTs);
  return {
    events,
    calendars: cals.map(({ id, name, color }) => ({ id, name, color })),
    updatedAt: new Date().toISOString(),
    rangeFrom: fromKey,
    rangeTo: toKey,
  };
}

// Périodes demandées par les écrans hors de la période en cache (navigation dans le temps).
const rangeCache = new Map<string, { at: number; data: AgendaData }>();
const RANGE_TTL = 10 * 60_000;
const MAX_RANGE_DAYS = 62;

/** Événements jour par jour entre `from` et `to` (exclu), depuis le cache ou iCloud. */
export async function agendaRange(ctx: IntegrationContext, from: string, to: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to <= from) throw new ConfigError('Période invalide.');
  const days: string[] = [];
  for (let d = from; d < to && days.length <= MAX_RANGE_DAYS; d = addDays(d, 1)) days.push(d);
  if (days.length > MAX_RANGE_DAYS) throw new ConfigError(`Période trop longue (${MAX_RANGE_DAYS} jours au plus).`);

  let data = getCache<AgendaData>(ctx.db, 'icloud')?.value ?? null;
  const covered = data?.rangeFrom && data.rangeTo && from >= data.rangeFrom && to <= data.rangeTo;
  if (!covered) {
    const key = `${ctx.householdId}:${from}:${to}`;
    const hit = rangeCache.get(key);
    if (hit && Date.now() - hit.at < RANGE_TTL) data = hit.data;
    else {
      data = await fetchAgenda(ctx, { from, to });
      if (rangeCache.size > 200) rangeCache.clear();
      rangeCache.set(key, { at: Date.now(), data });
    }
  }
  const events = data?.events ?? [];
  return {
    from,
    to,
    days: days.map((date) => ({
      date,
      events: events
        .map((e) => {
          const part = onDay(e, date);
          return part ? { ...part, id: e.id, location: e.location, calendar: e.calendar, important: e.important } : null;
        })
        .filter((x) => x !== null),
    })),
  };
}

export const icloud: IntegrationDef = {
  id: 'icloud',
  name: 'Calendrier iCloud',
  description: 'Événements et rappels',
  defaults: { appleId: '', calendars: [], intervalMinutes: 15 },
  secretFields: ['appPassword'],
  fields: () => [
    { key: 'appleId', label: 'Identifiant Apple', type: 'text', placeholder: 'prenom@icloud.com' },
    { key: 'appPassword', label: 'Mot de passe pour app', type: 'secret', help: 'À créer sur account.apple.com › Connexion et sécurité › Mots de passe pour app' },
    {
      key: 'intervalMinutes',
      label: 'Fréquence',
      type: 'select',
      options: [
        { value: '5', label: 'Toutes les 5 minutes' },
        { value: '15', label: 'Toutes les 15 minutes' },
        { value: '30', label: 'Toutes les 30 minutes' },
        { value: '60', label: 'Toutes les heures' },
      ],
    },
    { key: 'calendarNames', label: 'Calendriers choisis', type: 'chips' },
  ],
  actions: () => [{ id: 'calendars', label: 'Choisir les calendriers' }],
  missing: (ctx) => (ctx.config.appleId && ctx.secrets.appPassword ? null : 'Renseigne ton identifiant Apple et un mot de passe pour app.'),
  isDue: (ctx, last, now) => !last || now.getTime() - last.getTime() >= Number(ctx.config.intervalMinutes || 15) * 60_000,
  async run(ctx) {
    const data = await fetchAgenda(ctx);
    setCache(ctx.db, 'icloud', data);
    const time = new Date().toTimeString().slice(0, 5);
    return { status: 'ok', detail: `${data.calendars.length} calendrier${data.calendars.length > 1 ? 's' : ''} · synchronisé à ${time}` };
  },
  async test(ctx) {
    const cals = await listCalendars(ctx);
    return `${cals.length} calendrier${cals.length > 1 ? 's' : ''} trouvé${cals.length > 1 ? 's' : ''}`;
  },
  sanitizeConfig(patch) {
    const out: Record<string, unknown> = {};
    if ('appleId' in patch) {
      const v = str(patch.appleId, 120);
      if (v && !v.includes('@')) throw new ConfigError('L’identifiant Apple est une adresse e-mail.');
      out.appleId = v;
    }
    if ('calendars' in patch) {
      if (!Array.isArray(patch.calendars) || !patch.calendars.every((c) => typeof c === 'string' && c.length < 400)) {
        throw new ConfigError('Liste de calendriers invalide.');
      }
      out.calendars = patch.calendars.slice(0, 20);
    }
    if ('intervalMinutes' in patch) {
      const v = Number(patch.intervalMinutes);
      if (![5, 15, 30, 60].includes(v)) throw new ConfigError('Intervalle invalide.');
      out.intervalMinutes = v;
    }
    return out;
  },
  computed(ctx) {
    const cached = getCache<AgendaData>(ctx.db, 'icloud')?.value;
    return { calendarNames: cached?.calendars.map((c) => c.name) ?? [] };
  },
};

interface DayEvent {
  start: string;
  end: string;
  title: string;
  color: string;
  allDay: boolean;
}

/** Part d'un événement dans une journée (événements sur plusieurs jours inclus). */
function onDay(e: AgendaEvent, date: string): DayEvent | null {
  if (e.allDay) {
    const last = e.endDate && e.endDate > e.date ? e.endDate : addDays(e.date, 1); // fin exclusive
    if (date < e.date || date >= last) return null;
    return { start: '', end: '', title: e.title, color: e.color, allDay: true };
  }
  const dayStart = new Date(`${date}T00:00:00`).getTime();
  const dayEnd = new Date(`${addDays(date, 1)}T00:00:00`).getTime();
  const endTs = e.endTs && e.endTs > e.startTs ? e.endTs : e.startTs + 3600_000;
  if (e.startTs >= dayEnd || endTs <= dayStart) return null;
  return {
    start: e.startTs < dayStart ? '00:00' : e.start,
    end: endTs > dayEnd ? '24:00' : e.end,
    title: e.title,
    color: e.color,
    allDay: false,
  };
}

export function agendaForDevice(db: DB) {
  const data = getCache<AgendaData>(db, 'icloud')?.value;
  if (!data) return null;
  const today = dateKey();
  const now = Date.now();
  const strip = ({ id, start, end, title, location, calendar, color, allDay, important, reminderMinutes }: AgendaEvent) => ({
    id, start, end, title, location, calendar, color, allDay, important, reminderMinutes,
  });
  // Aujourd'hui : tout ce qui touche la journée (y compris un événement commencé la veille).
  const todayEvents = data.events.filter((e) => onDay(e, today)).map((e) => ({ ...strip(e), date: today }));
  const upcoming = data.events.filter((e) => e.startTs >= now).slice(0, 6);
  // Les 7 prochains jours à partir d'aujourd'hui (la grille du calendrier n'est jamais « dans le passé »).
  const week = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(today, i);
    const events = data.events.map((e) => onDay(e, date)).filter((x): x is DayEvent => x !== null);
    return { date, events };
  });
  const month = today.slice(0, 7);
  const monthDays = [...new Set(data.events.filter((e) => e.date.startsWith(month)).map((e) => Number(e.date.slice(8, 10))))].sort((a, b) => a - b);
  return {
    today: todayEvents,
    upcoming: upcoming.map((e) => ({ ...strip(e), date: e.date })),
    week,
    monthDays,
  };
}
