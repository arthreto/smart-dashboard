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
    title: (typeof ev.summary === 'string' ? ev.summary : String((ev.summary as unknown as { val?: string })?.val ?? '')) || 'Sans titre',
    location: typeof ev.location === 'string' ? ev.location : '',
    calendar: cal.name,
    color: cal.color,
    allDay,
    important: priority > 0 && priority <= 4,
    reminderMinutes: reminderOf(ev),
  });
}

function expandEvent(out: AgendaEvent[], ev: ical.VEvent, from: Date, to: Date, cal: { name: string; color: string }) {
  if (!ev.start) return;
  const start = new Date(ev.start);
  const duration = (ev.end ? new Date(ev.end).getTime() : start.getTime() + 3600_000) - start.getTime();
  if (!ev.rrule) {
    if (start < to && start.getTime() + duration > from.getTime()) pushOccurrence(out, ev, start, new Date(start.getTime() + duration), cal, '');
    return;
  }
  const exdates = new Set(Object.values((ev.exdate ?? {}) as Record<string, Date>).map((d) => new Date(d).toISOString().slice(0, 10)));
  for (const occ of ev.rrule.between(new Date(from.getTime() - duration), to, true)) {
    const day = occ.toISOString().slice(0, 10);
    if (exdates.has(day)) continue;
    const override = ev.recurrences?.[day];
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

async function fetchAgenda(ctx: IntegrationContext): Promise<AgendaData> {
  const c = await client(ctx);
  const all = await c.fetchCalendars();
  const wanted: string[] = Array.isArray(ctx.config.calendars) ? ctx.config.calendars : [];
  const cals = all
    .map((cal, i) => ({ cal, id: cal.url, name: calName(cal), color: normColor(cal.calendarColor, i) }))
    .filter((x) => (!x.cal.components || x.cal.components.includes('VEVENT')) && (wanted.length === 0 || wanted.includes(x.id)));

  const today = dateKey();
  const monthStart = today.slice(0, 8) + '01';
  const fromKey = monthStart < mondayOf(today) ? monthStart : mondayOf(today);
  const from = new Date(`${fromKey}T00:00:00`);
  const to = new Date(`${addDays(today, 45)}T00:00:00`);

  const events: AgendaEvent[] = [];
  for (const x of cals) {
    const objects = await c.fetchCalendarObjects({
      calendar: x.cal,
      timeRange: { start: from.toISOString(), end: to.toISOString() },
    });
    for (const obj of objects) {
      if (typeof obj.data !== 'string') continue;
      let parsed: ical.CalendarResponse;
      try {
        parsed = ical.sync.parseICS(obj.data);
      } catch {
        continue;
      }
      for (const comp of Object.values(parsed)) {
        if (comp && (comp as { type?: string }).type === 'VEVENT') expandEvent(events, comp as ical.VEvent, from, to, x);
      }
    }
  }
  events.sort((a, b) => a.startTs - b.startTs);
  return { events, calendars: cals.map(({ id, name, color }) => ({ id, name, color })), updatedAt: new Date().toISOString() };
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
    { key: 'calendarNames', label: 'Calendriers affichés', type: 'chips' },
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

export function agendaForDevice(db: DB) {
  const data = getCache<AgendaData>(db, 'icloud')?.value;
  if (!data) return null;
  const today = dateKey();
  const now = Date.now();
  const monday = mondayOf(today);
  const strip = ({ id, start, end, title, location, calendar, color, allDay, important, reminderMinutes }: AgendaEvent) => ({
    id, start, end, title, location, calendar, color, allDay, important, reminderMinutes,
  });
  const todayEvents = data.events.filter((e) => e.date === today);
  const upcoming = data.events.filter((e) => e.startTs >= now).slice(0, 5);
  const week = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(monday, i);
    return { date, events: data.events.filter((e) => e.date === date).map(({ start, end, title, color, allDay }) => ({ start, end, title, color, allDay })) };
  });
  const month = today.slice(0, 7);
  const monthDays = [...new Set(data.events.filter((e) => e.date.startsWith(month)).map((e) => Number(e.date.slice(8, 10))))].sort((a, b) => a - b);
  return {
    today: todayEvents.map(strip),
    upcoming: upcoming.map((e) => ({ ...strip(e), date: e.date })),
    week,
    monthDays,
  };
}
