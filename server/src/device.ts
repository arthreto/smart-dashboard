import crypto from 'node:crypto';
import type { DB } from './db.js';
import { getSetting, setSetting } from './db.js';
import { config } from './config.js';
import { randomToken, sha256, safeEqual } from './crypto.js';
import { logEvent } from './events.js';
import { ValidationError, HabitBook, computeBadges, computeStats, habitMeta } from './habits.js';
import { getRoutine, listAlarms, nextAlarm } from './alarms.js';
import { isEnabled, makeContext, getDef } from './integrations/index.js';
import { weatherForDevice } from './integrations/weather.js';
import { robloxForDevice } from './integrations/roblox.js';
import { cinemaForDevice } from './integrations/pathe.js';
import { agendaForDevice } from './integrations/icloud.js';
import { nowPlaying, type MusicState } from './integrations/spotify.js';
import { errorMessage } from './http.js';

// ---------------------------------------------------------------- réglages d'affichage

export interface DisplaySettings {
  brightness: number;
  theme: 'dark' | 'light' | 'auto';
  nightMode: { enabled: boolean; start: string; end: string; brightness: number };
  warmTint: boolean;
  screenSleepSeconds: number;
  deepSleepMinutes: number;
  touchWake: boolean;
  lockOnWake: boolean;
  lockAfterMinutes: number;
  pollSeconds: number;
}

export const DEFAULT_DISPLAY: DisplaySettings = {
  brightness: 60,
  theme: 'dark',
  nightMode: { enabled: true, start: '22:00', end: '07:00', brightness: 10 },
  warmTint: true,
  screenSleepSeconds: 30,
  deepSleepMinutes: 10,
  touchWake: true,
  lockOnWake: true,
  lockAfterMinutes: 5,
  pollSeconds: 60,
};

const HM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function getDisplay(db: DB): DisplaySettings {
  const saved = getSetting<Partial<DisplaySettings>>(db, 'display', {});
  return { ...DEFAULT_DISPLAY, ...saved, nightMode: { ...DEFAULT_DISPLAY.nightMode, ...(saved.nightMode ?? {}) } };
}

function intIn(v: unknown, min: number, max: number, label: string): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new ValidationError(`${label} doit être entre ${min} et ${max}.`);
  return n;
}

export function saveDisplay(db: DB, input: Record<string, unknown>): DisplaySettings {
  const next = getDisplay(db);
  if ('brightness' in input) next.brightness = intIn(input.brightness, 5, 100, 'La luminosité');
  if ('theme' in input) {
    if (!['dark', 'light', 'auto'].includes(input.theme as string)) throw new ValidationError('Thème inconnu.');
    next.theme = input.theme as DisplaySettings['theme'];
  }
  if ('nightMode' in input) {
    const nm = input.nightMode as Record<string, unknown>;
    if (!nm || typeof nm !== 'object') throw new ValidationError('Mode nuit invalide.');
    if ('enabled' in nm) next.nightMode.enabled = !!nm.enabled;
    if ('start' in nm) {
      if (!HM.test(String(nm.start))) throw new ValidationError('Heure de début invalide.');
      next.nightMode.start = String(nm.start);
    }
    if ('end' in nm) {
      if (!HM.test(String(nm.end))) throw new ValidationError('Heure de fin invalide.');
      next.nightMode.end = String(nm.end);
    }
    if ('brightness' in nm) next.nightMode.brightness = intIn(nm.brightness, 1, 100, 'La luminosité de nuit');
  }
  if ('warmTint' in input) next.warmTint = !!input.warmTint;
  if ('screenSleepSeconds' in input) next.screenSleepSeconds = intIn(input.screenSleepSeconds, 10, 3600, 'La mise en veille');
  if ('deepSleepMinutes' in input) next.deepSleepMinutes = intIn(input.deepSleepMinutes, 1, 1440, 'La veille profonde');
  if ('touchWake' in input) next.touchWake = !!input.touchWake;
  if ('lockOnWake' in input) next.lockOnWake = !!input.lockOnWake;
  if ('lockAfterMinutes' in input) next.lockAfterMinutes = intIn(input.lockAfterMinutes, 0, 120, 'Le verrouillage');
  if ('pollSeconds' in input) next.pollSeconds = intIn(input.pollSeconds, 15, 900, 'La synchronisation');
  setSetting(db, 'display', next);
  return next;
}

// ---------------------------------------------------------------- disposition de l'accueil

export const WIDGETS: Record<string, string> = {
  clock: 'Horloge',
  weather: 'Météo',
  music: 'Spotify',
  agenda: 'Agenda',
  tasks: 'Tâches',
  roblox: 'Roblox',
  cinema: 'Prochaine séance ciné',
  streak: 'Série',
};

export interface Widget {
  id: string;
  span: 1 | 2;
}

export const DEFAULT_LAYOUT: Widget[] = [
  { id: 'clock', span: 2 },
  { id: 'weather', span: 1 },
  { id: 'music', span: 1 },
  { id: 'agenda', span: 2 },
  { id: 'tasks', span: 1 },
  { id: 'roblox', span: 1 },
];

export function getLayout(db: DB): Widget[] {
  return getSetting<Widget[]>(db, 'layout', DEFAULT_LAYOUT);
}

export function saveLayout(db: DB, widgets: unknown): Widget[] {
  if (!Array.isArray(widgets) || widgets.length === 0) throw new ValidationError('Disposition vide.');
  const seen = new Set<string>();
  let total = 0;
  const clean: Widget[] = widgets.map((w) => {
    const id = (w as Widget)?.id;
    const span = Number((w as Widget)?.span);
    if (!(id in WIDGETS)) throw new ValidationError(`Widget inconnu : ${id}`);
    if (seen.has(id)) throw new ValidationError(`Widget en double : ${WIDGETS[id]}`);
    if (span !== 1 && span !== 2) throw new ValidationError('Largeur de widget invalide.');
    seen.add(id);
    total += span;
    return { id, span: span as 1 | 2 };
  });
  // Placement en grille 4 colonnes : une tuile de 2 qui ne tient pas en fin de rangée passe à la suivante.
  let rowsUsed = 1;
  let col = 0;
  for (const w of clean) {
    if (col + w.span > 4) {
      rowsUsed++;
      col = 0;
    }
    col += w.span;
  }
  if (total > 8 || rowsUsed > 2) throw new ValidationError('L’accueil contient au plus 2 rangées de 4 cases.');
  setSetting(db, 'layout', clean);
  return clean;
}

// ---------------------------------------------------------------- code PIN

interface PinSetting {
  salt: string;
  hash: string;
  updatedAt: string;
}

export function setPin(db: DB, pin: unknown): void {
  if (typeof pin !== 'string' || !/^\d{4,6}$/.test(pin)) throw new ValidationError('Le code doit contenir 4 à 6 chiffres.');
  const salt = crypto.randomBytes(16).toString('hex');
  setSetting(db, 'pin', { salt, hash: sha256(salt + pin), updatedAt: new Date().toISOString() } satisfies PinSetting);
  logEvent(db, 'device', 'info', 'Code PIN de l’écran modifié');
}

export function getPin(db: DB): PinSetting | null {
  return getSetting<PinSetting | null>(db, 'pin', null);
}

// ---------------------------------------------------------------- appairage

interface DeviceRow {
  name: string;
  token_hash: string | null;
  paired_at: string | null;
  last_seen_at: string | null;
  last_sync_at: string | null;
  battery: number | null;
  charging: number | null;
  firmware: string | null;
  rssi: number | null;
  ip: string | null;
  screen: string | null;
}

export function getDeviceRow(db: DB): DeviceRow {
  return db.prepare('SELECT * FROM device WHERE id = 1').get() as DeviceRow;
}

export function createPairingCode(db: DB): { code: string; expiresAt: string } {
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  db.prepare('DELETE FROM pairing_codes').run();
  db.prepare('INSERT INTO pairing_codes (code_hash, expires_at) VALUES (?, ?)').run(sha256(code), expiresAt);
  return { code, expiresAt };
}

export function pairDevice(db: DB, code: unknown, name: unknown, firmware: unknown): string | null {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return null;
  const row = db.prepare('SELECT expires_at FROM pairing_codes WHERE code_hash = ?').get(sha256(code)) as { expires_at: string } | undefined;
  if (!row || new Date(row.expires_at).getTime() < Date.now()) return null;
  const token = `sdb_${randomToken(32)}`;
  db.prepare('DELETE FROM pairing_codes').run();
  db.prepare('UPDATE device SET token_hash = ?, paired_at = ?, name = ?, firmware = ? WHERE id = 1').run(
    sha256(token),
    new Date().toISOString(),
    typeof name === 'string' && name.trim() ? name.trim().slice(0, 40) : 'Tab5',
    typeof firmware === 'string' ? firmware.slice(0, 40) : null,
  );
  logEvent(db, 'device', 'success', 'Tablette associée');
  return token;
}

export function checkDeviceToken(db: DB, header: string | undefined): boolean {
  if (!header?.startsWith('Bearer ')) return false;
  const stored = getDeviceRow(db).token_hash;
  return !!stored && safeEqual(sha256(header.slice(7).trim()), stored);
}

export function unpair(db: DB): void {
  db.prepare('UPDATE device SET token_hash = NULL, paired_at = NULL WHERE id = 1').run();
  logEvent(db, 'device', 'warning', 'Tablette désassociée : elle devra être ré-appairée');
}

export function recordHeartbeat(db: DB, body: Record<string, unknown>, ip: string): void {
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);
  db.prepare('UPDATE device SET last_seen_at = ?, battery = COALESCE(?, battery), charging = COALESCE(?, charging), firmware = COALESCE(?, firmware), rssi = COALESCE(?, rssi), ip = ?, screen = COALESCE(?, screen) WHERE id = 1').run(
    new Date().toISOString(),
    n(body.battery),
    typeof body.charging === 'boolean' ? (body.charging ? 1 : 0) : null,
    typeof body.firmware === 'string' ? body.firmware.slice(0, 40) : null,
    n(body.rssi),
    typeof body.ip === 'string' && body.ip ? body.ip.slice(0, 64) : ip,
    typeof body.screen === 'string' ? body.screen.slice(0, 10) : null,
  );
  if (Array.isArray(body.ackCommands)) {
    const ack = db.prepare('UPDATE commands SET acked_at = ? WHERE id = ? AND acked_at IS NULL');
    for (const id of body.ackCommands.slice(0, 50)) if (Number.isInteger(id)) ack.run(new Date().toISOString(), id);
  }
}

export function deviceOnline(row: DeviceRow): boolean {
  if (!row.last_seen_at) return false;
  const poll = 60;
  return Date.now() - new Date(row.last_seen_at).getTime() < Math.max(3 * poll, 180) * 1000;
}

/** Autonomie estimée (jours) à partir du niveau de batterie : ~0,9 %/h en usage normal. */
export function autonomyDays(battery: number | null): number | null {
  if (battery === null || battery === undefined) return null;
  return Math.max(0, Math.round((battery / 100) * 11.5));
}

export function deviceInfo(db: DB) {
  const row = getDeviceRow(db);
  const pin = getPin(db);
  return {
    paired: !!row.token_hash,
    name: row.name,
    firmware: row.firmware,
    lastSeenAt: row.last_seen_at,
    lastSyncAt: row.last_sync_at,
    battery: row.battery,
    charging: row.charging === null ? null : !!row.charging,
    online: deviceOnline(row),
    rssi: row.rssi,
    ip: row.ip,
    autonomyDays: autonomyDays(row.battery),
    pinSet: !!pin,
    pinUpdatedAt: pin?.updatedAt ?? null,
    settings: getDisplay(db),
    layout: getLayout(db),
    availableWidgets: Object.entries(WIDGETS)
      .filter(([id]) => !getLayout(db).some((w) => w.id === id))
      .map(([id, label]) => ({ id, label })),
  };
}

export const COMMAND_TYPES = ['wake', 'lock', 'reboot', 'message', 'reload', 'screenshot'] as const;

export function queueCommand(db: DB, type: unknown, text: unknown): number {
  if (!COMMAND_TYPES.includes(type as (typeof COMMAND_TYPES)[number])) throw new ValidationError('Commande inconnue.');
  if (type === 'message' && (typeof text !== 'string' || !text.trim() || text.length > 140)) {
    throw new ValidationError('Le message doit faire entre 1 et 140 caractères.');
  }
  const res = db.prepare('INSERT INTO commands (type, text, created_at) VALUES (?, ?, ?)').run(
    type,
    type === 'message' ? (text as string).trim() : null,
    new Date().toISOString(),
  );
  logEvent(db, 'console', 'info', type === 'message' ? `Message envoyé à l’écran : « ${(text as string).trim()} »` : `Commande envoyée à l’écran : ${type}`);
  return Number(res.lastInsertRowid);
}

function pendingCommands(db: DB) {
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  return db.prepare('SELECT id, type, text FROM commands WHERE acked_at IS NULL AND created_at >= ? ORDER BY id').all(since) as {
    id: number;
    type: string;
    text: string | null;
  }[];
}

// ---------------------------------------------------------------- état complet pour la tablette

export function tasksForDevice(db: DB, book = new HabitBook(db)) {
  const today = book.today;
  const s = book.dayStats(today);
  const items = book.active
    .filter((h) => h.show_on_device && book.scheduled(h, today))
    .map((h) => ({ id: h.id, name: h.name, meta: habitMeta(h), icon: h.icon, color: h.color, done: book.isDone(h, today), streak: book.habitStreak(h) }));
  const monthStart = today.slice(0, 8) + '01';
  const weekRate = book.rateBetween(book.week()[0].date, today).rate;
  return {
    date: today,
    done: s.done,
    total: s.total,
    streak: book.streak(),
    bestStreak: book.bestStreak(),
    weekRate,
    monthRate: book.rateBetween(monthStart, today).rate,
    items,
    week: book.week().map(({ label, state }) => ({ label, state })),
    badges: computeBadges(book).map(({ label, unlocked, progress, target }) => ({ label, unlocked, progress, target })),
  };
}

async function musicForDevice(db: DB): Promise<MusicState | null> {
  if (!isEnabled(db, 'spotify')) return null;
  const ctx = makeContext(db, 'spotify');
  if (getDef('spotify')!.missing(ctx)) return null;
  try {
    return await nowPlaying(ctx);
  } catch (err) {
    return { available: false, isPlaying: false, deviceName: '', volume: 0, liked: false, track: null, queue: [], message: errorMessage(err) };
  }
}

export async function buildDeviceState(db: DB) {
  const book = new HabitBook(db);
  const display = getDisplay(db);
  const pin = getPin(db);
  const alarms = listAlarms(db);
  const next = nextAlarm(alarms);
  db.prepare('UPDATE device SET last_sync_at = ? WHERE id = 1').run(new Date().toISOString());
  return {
    serverTime: Math.floor(Date.now() / 1000),
    tz: config.tz,
    tzPosix: config.tzPosix,
    settings: { ...display, pinSalt: pin?.salt ?? '', pinHash: pin?.hash ?? '' },
    layout: getLayout(db),
    weather: isEnabled(db, 'weather') ? weatherForDevice(db) : null,
    agenda: isEnabled(db, 'icloud') ? agendaForDevice(db) : null,
    tasks: tasksForDevice(db, book),
    alarms,
    nextAlarm: next ? { at: Math.floor(next.at / 1000), label: next.label, time: next.time } : null,
    routine: getRoutine(db),
    music: await musicForDevice(db),
    roblox: isEnabled(db, 'roblox') ? robloxForDevice(db) : null,
    cinema: isEnabled(db, 'pathe') ? cinemaForDevice(db) : null,
    stats: computeStats(db, book, getSetting<number>(db, 'sportGoal', 12)),
    commands: pendingCommands(db),
  };
}
