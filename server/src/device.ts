// Écrans (tablettes) : un foyer peut en avoir plusieurs. Chaque écran est enregistré dans
// la base principale (jeton, état, réglages d'affichage, disposition de l'accueil) ; ses
// réveils et commandes sont dans la base de son foyer (colonne device_id).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { DB } from './db.js';
import { getSetting, setSetting } from './db.js';
import { config } from './config.js';
import { randomToken, sha256 } from './crypto.js';
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
import { household, main } from './households.js';

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

export function mergeDisplay(saved: Partial<DisplaySettings>): DisplaySettings {
  return { ...DEFAULT_DISPLAY, ...saved, nightMode: { ...DEFAULT_DISPLAY.nightMode, ...(saved.nightMode ?? {}) } };
}

function intIn(v: unknown, min: number, max: number, label: string): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new ValidationError(`${label} doit être entre ${min} et ${max}.`);
  return n;
}

/** Applique une modification validée aux réglages d'affichage d'un écran. */
export function applyDisplay(current: DisplaySettings, input: Record<string, unknown>): DisplaySettings {
  const next = mergeDisplay(JSON.parse(JSON.stringify(current)) as DisplaySettings);
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

/** Vérifie une disposition de l'accueil (au plus 2 rangées de 4 cases). */
export function validateLayout(widgets: unknown): Widget[] {
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
  return clean;
}

// ---------------------------------------------------------------- code PIN (commun au foyer)

interface PinSetting {
  salt: string;
  hash: string;
  updatedAt: string;
}

export function setPin(db: DB, pin: unknown): void {
  if (typeof pin !== 'string' || !/^\d{4,6}$/.test(pin)) throw new ValidationError('Le code doit contenir 4 à 6 chiffres.');
  const salt = crypto.randomBytes(16).toString('hex');
  setSetting(db, 'pin', { salt, hash: sha256(salt + pin), updatedAt: new Date().toISOString() } satisfies PinSetting);
  logEvent(db, 'device', 'info', 'Code PIN des écrans modifié');
}

export function getPin(db: DB): PinSetting | null {
  return getSetting<PinSetting | null>(db, 'pin', null);
}

// ---------------------------------------------------------------- écrans

export interface DeviceRow {
  id: number;
  household_id: number;
  name: string;
  token_hash: string | null;
  created_at: string;
  paired_at: string | null;
  last_seen_at: string | null;
  last_sync_at: string | null;
  battery: number | null;
  charging: number | null;
  firmware: string | null;
  rssi: number | null;
  ip: string | null;
  screen: string | null;
  display: string;
  layout: string | null;
}

function parse<T>(s: string | null, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

export function getDevice(id: number): DeviceRow | undefined {
  return main().prepare('SELECT * FROM devices WHERE id = ?').get(id) as DeviceRow | undefined;
}

/** Écran d'un foyer donné (undefined s'il appartient à un autre foyer). */
export function getHouseholdDevice(householdId: number, id: number): DeviceRow | undefined {
  return main().prepare('SELECT * FROM devices WHERE id = ? AND household_id = ?').get(id, householdId) as DeviceRow | undefined;
}

export function listDevices(householdId: number): DeviceRow[] {
  return main().prepare('SELECT * FROM devices WHERE household_id = ? ORDER BY id').all(householdId) as DeviceRow[];
}

export function deviceDisplay(d: DeviceRow): DisplaySettings {
  return mergeDisplay(parse<Partial<DisplaySettings>>(d.display, {}));
}

export function deviceLayout(d: DeviceRow): Widget[] {
  return parse<Widget[] | null>(d.layout, null) ?? DEFAULT_LAYOUT;
}

export function saveDeviceDisplay(d: DeviceRow, input: Record<string, unknown>): DisplaySettings {
  const next = applyDisplay(deviceDisplay(d), input);
  main().prepare('UPDATE devices SET display = ? WHERE id = ?').run(JSON.stringify(next), d.id);
  return next;
}

export function saveDeviceLayout(d: DeviceRow, widgets: unknown): Widget[] {
  const clean = validateLayout(widgets);
  main().prepare('UPDATE devices SET layout = ? WHERE id = ?').run(JSON.stringify(clean), d.id);
  return clean;
}

export function renameDevice(d: DeviceRow, name: unknown): void {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 40) throw new ValidationError('Le nom doit faire entre 1 et 40 caractères.');
  main().prepare('UPDATE devices SET name = ? WHERE id = ?').run(name.trim(), d.id);
}

export function screenshotFile(deviceId: number): string {
  return path.join(config.dataDir, 'screens', `${deviceId}.jpg`);
}

/** Retire un écran du foyer : ses réveils, ses commandes et sa dernière capture. */
export function removeDevice(d: DeviceRow): void {
  const db = household(d.household_id);
  db.prepare('DELETE FROM alarms WHERE device_id = ?').run(d.id);
  db.prepare('DELETE FROM commands WHERE device_id = ?').run(d.id);
  db.prepare('DELETE FROM settings WHERE key = ?').run(`routine:${d.id}`);
  main().prepare('DELETE FROM devices WHERE id = ?').run(d.id);
  fs.rmSync(screenshotFile(d.id), { force: true });
  logEvent(db, 'device', 'warning', `Écran « ${d.name} » retiré du foyer`);
}

export function removeHouseholdDeviceFiles(householdId: number): void {
  for (const d of listDevices(householdId)) fs.rmSync(screenshotFile(d.id), { force: true });
}

// ---------------------------------------------------------------- appairage

/**
 * Code à 6 chiffres valable 10 minutes, pour associer un nouvel écran au foyer
 * (ou ré-associer un écran existant : son jeton est alors remplacé).
 */
export function createPairingCode(householdId: number, opts: { deviceId?: number; name?: unknown } = {}): { code: string; expiresAt: string } {
  const m = main();
  if (opts.deviceId !== undefined && !getHouseholdDevice(householdId, opts.deviceId)) throw new ValidationError('Écran introuvable.');
  const name = typeof opts.name === 'string' ? opts.name.trim().slice(0, 40) : '';
  let code = '';
  for (let i = 0; i < 20; i++) {
    code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    if (!m.prepare('SELECT 1 FROM pairing_codes WHERE code_hash = ?').get(sha256(code))) break;
  }
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  m.prepare('DELETE FROM pairing_codes WHERE household_id = ? OR expires_at < ?').run(householdId, new Date().toISOString());
  m.prepare('INSERT INTO pairing_codes (code_hash, household_id, device_id, name, expires_at) VALUES (?, ?, ?, ?, ?)').run(
    sha256(code),
    householdId,
    opts.deviceId ?? null,
    name,
    expiresAt,
  );
  return { code, expiresAt };
}

/** Échange un code contre le jeton de l'écran. */
export function pairDevice(code: unknown, name: unknown, firmware: unknown): { token: string; device: DeviceRow } | null {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return null;
  const m = main();
  const row = m.prepare('SELECT * FROM pairing_codes WHERE code_hash = ?').get(sha256(code)) as
    | { code_hash: string; household_id: number; device_id: number | null; name: string; expires_at: string }
    | undefined;
  if (!row || new Date(row.expires_at).getTime() < Date.now()) return null;
  const token = `sdb_${randomToken(32)}`;
  const now = new Date().toISOString();
  const fw = typeof firmware === 'string' ? firmware.slice(0, 40) : null;
  const db = household(row.household_id);
  let id: number;
  m.prepare('DELETE FROM pairing_codes WHERE code_hash = ?').run(row.code_hash);
  if (row.device_id && getHouseholdDevice(row.household_id, row.device_id)) {
    id = row.device_id;
    m.prepare('UPDATE devices SET token_hash = ?, paired_at = ?, firmware = COALESCE(?, firmware) WHERE id = ?').run(sha256(token), now, fw, id);
    logEvent(db, 'device', 'success', `Écran « ${getDevice(id)!.name} » ré-associé`);
  } else {
    const count = listDevices(row.household_id).length;
    const deviceName =
      row.name || (typeof name === 'string' && name.trim() && name.trim() !== 'Tab5' ? name.trim().slice(0, 40) : `Écran ${count + 1}`);
    // Les réglages d'affichage et la disposition du foyer servent de modèle au nouvel écran.
    const display = JSON.stringify(mergeDisplay(getSetting<Partial<DisplaySettings>>(db, 'display', {})));
    const layout = getSetting<Widget[] | null>(db, 'layout', null);
    const res = m
      .prepare('INSERT INTO devices (household_id, name, token_hash, created_at, paired_at, firmware, display, layout) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(row.household_id, deviceName, sha256(token), now, now, fw, display, layout ? JSON.stringify(layout) : null);
    id = Number(res.lastInsertRowid);
    // Réveils pas encore attribués (exemples du foyer, ancienne installation) : repris par cet écran.
    db.prepare('UPDATE alarms SET device_id = ? WHERE device_id IS NULL').run(id);
    logEvent(db, 'device', 'success', `Nouvel écran associé : « ${deviceName} »`);
  }
  return { token, device: getDevice(id)! };
}

/** Écran correspondant à l'en-tête « Authorization: Bearer sdb_… ». */
export function deviceFromAuthHeader(header: string | undefined): DeviceRow | null {
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  if (!token.startsWith('sdb_') || token.length > 100) return null;
  return (main().prepare('SELECT * FROM devices WHERE token_hash = ?').get(sha256(token)) as DeviceRow | undefined) ?? null;
}

export function recordHeartbeat(d: DeviceRow, body: Record<string, unknown>, ip: string): void {
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);
  main()
    .prepare(
      'UPDATE devices SET last_seen_at = ?, battery = COALESCE(?, battery), charging = COALESCE(?, charging), firmware = COALESCE(?, firmware), rssi = COALESCE(?, rssi), ip = ?, screen = COALESCE(?, screen) WHERE id = ?',
    )
    .run(
      new Date().toISOString(),
      n(body.battery),
      typeof body.charging === 'boolean' ? (body.charging ? 1 : 0) : null,
      typeof body.firmware === 'string' ? body.firmware.slice(0, 40) : null,
      n(body.rssi),
      typeof body.ip === 'string' && body.ip ? body.ip.slice(0, 64) : ip,
      typeof body.screen === 'string' ? body.screen.slice(0, 10) : null,
      d.id,
    );
  if (Array.isArray(body.ackCommands)) {
    const ack = household(d.household_id).prepare('UPDATE commands SET acked_at = ? WHERE id = ? AND device_id = ? AND acked_at IS NULL');
    for (const id of body.ackCommands.slice(0, 50)) if (Number.isInteger(id)) ack.run(new Date().toISOString(), id, d.id);
  }
}

export function deviceOnline(row: DeviceRow): boolean {
  if (!row.last_seen_at) return false;
  const poll = deviceDisplay(row).pollSeconds;
  return Date.now() - new Date(row.last_seen_at).getTime() < Math.max(3 * poll, 180) * 1000;
}

/** Autonomie estimée (jours) à partir du niveau de batterie : ~0,9 %/h en usage normal. */
export function autonomyDays(battery: number | null): number | null {
  if (battery === null || battery === undefined) return null;
  return Math.max(0, Math.round((battery / 100) * 11.5));
}

/** Résumé d'un écran (liste, vue d'ensemble). */
export function deviceSummary(row: DeviceRow) {
  return {
    id: row.id,
    name: row.name,
    paired: !!row.token_hash,
    online: deviceOnline(row),
    firmware: row.firmware,
    lastSeenAt: row.last_seen_at,
    lastSyncAt: row.last_sync_at,
    battery: row.battery,
    charging: row.charging === null ? null : !!row.charging,
    rssi: row.rssi,
    ip: row.ip,
    autonomyDays: autonomyDays(row.battery),
    pairedAt: row.paired_at,
  };
}

/** Détail complet d'un écran pour la console. */
export function deviceInfo(row: DeviceRow, db: DB) {
  const layout = deviceLayout(row);
  const pin = getPin(db);
  return {
    ...deviceSummary(row),
    pinSet: !!pin,
    pinUpdatedAt: pin?.updatedAt ?? null,
    settings: deviceDisplay(row),
    layout,
    availableWidgets: Object.entries(WIDGETS)
      .filter(([id]) => !layout.some((w) => w.id === id))
      .map(([id, label]) => ({ id, label })),
  };
}

export const COMMAND_TYPES = ['wake', 'lock', 'reboot', 'message', 'reload', 'screenshot'] as const;

export function queueCommand(db: DB, d: DeviceRow, type: unknown, text: unknown): number {
  if (!COMMAND_TYPES.includes(type as (typeof COMMAND_TYPES)[number])) throw new ValidationError('Commande inconnue.');
  if (type === 'message' && (typeof text !== 'string' || !text.trim() || text.length > 140)) {
    throw new ValidationError('Le message doit faire entre 1 et 140 caractères.');
  }
  const res = db.prepare('INSERT INTO commands (type, text, created_at, device_id) VALUES (?, ?, ?, ?)').run(
    type,
    type === 'message' ? (text as string).trim() : null,
    new Date().toISOString(),
    d.id,
  );
  logEvent(db, 'console', 'info', type === 'message' ? `Message envoyé à « ${d.name} » : « ${(text as string).trim()} »` : `Commande envoyée à « ${d.name} » : ${type}`);
  return Number(res.lastInsertRowid);
}

/** Message pour tous les écrans du foyer (ex. alerte cinéma). */
export function broadcastMessage(db: DB, householdId: number, text: string): void {
  const ins = db.prepare('INSERT INTO commands (type, text, created_at, device_id) VALUES (?, ?, ?, ?)');
  const now = new Date().toISOString();
  for (const d of listDevices(householdId)) if (d.token_hash) ins.run('message', text, now, d.id);
}

function pendingCommands(db: DB, deviceId: number) {
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  return db
    .prepare('SELECT id, type, text FROM commands WHERE acked_at IS NULL AND device_id = ? AND created_at >= ? ORDER BY id')
    .all(deviceId, since) as {
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

export async function buildDeviceState(d: DeviceRow) {
  const db = household(d.household_id);
  const book = new HabitBook(db);
  const display = deviceDisplay(d);
  const pin = getPin(db);
  const alarms = listAlarms(db, d.id);
  const next = nextAlarm(alarms);
  main().prepare('UPDATE devices SET last_sync_at = ? WHERE id = ?').run(new Date().toISOString(), d.id);
  return {
    serverTime: Math.floor(Date.now() / 1000),
    tz: config.tz,
    tzPosix: config.tzPosix,
    device: { id: d.id, name: d.name },
    settings: { ...display, pinSalt: pin?.salt ?? '', pinHash: pin?.hash ?? '' },
    layout: deviceLayout(d),
    weather: isEnabled(db, 'weather') ? weatherForDevice(db) : null,
    agenda: isEnabled(db, 'icloud') ? agendaForDevice(db) : null,
    tasks: tasksForDevice(db, book),
    alarms,
    nextAlarm: next ? { at: Math.floor(next.at / 1000), label: next.label, time: next.time } : null,
    routine: getRoutine(db, d.id),
    music: await musicForDevice(db),
    roblox: isEnabled(db, 'roblox') ? robloxForDevice(db) : null,
    cinema: isEnabled(db, 'pathe') ? cinemaForDevice(db) : null,
    stats: computeStats(db, book, getSetting<number>(db, 'sportGoal', 12)),
    commands: pendingCommands(db, d.id),
  };
}
