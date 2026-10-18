import type { DB } from './db.js';
import { getSetting, setSetting } from './db.js';
import { daysFromMask, maskFromDays } from './dates.js';
import { ValidationError } from './habits.js';

export const ALARM_SOUNDS = ['aube', 'carillon', 'pulsation', 'douce'] as const;

interface AlarmRow {
  id: number;
  device_id: number | null;
  time: string;
  label: string;
  days: number;
  sound: string;
  enabled: number;
  snooze_minutes: number;
}

export interface AlarmDto {
  id: number;
  deviceId: number | null;
  time: string;
  label: string;
  days: boolean[];
  sound: string;
  enabled: boolean;
  snoozeMinutes: number;
}

export interface AlarmInput {
  time?: string;
  label?: string;
  days?: boolean[];
  sound?: string;
  enabled?: boolean;
  snoozeMinutes?: number;
}

function toDto(r: AlarmRow): AlarmDto {
  return { id: r.id, deviceId: r.device_id, time: r.time, label: r.label, days: daysFromMask(r.days), sound: r.sound, enabled: !!r.enabled, snoozeMinutes: r.snooze_minutes };
}

/** Réveils d'un écran (ou de tout le foyer si deviceId est omis). */
export function listAlarms(db: DB, deviceId?: number): AlarmDto[] {
  const rows =
    deviceId === undefined
      ? (db.prepare('SELECT * FROM alarms ORDER BY time, id').all() as AlarmRow[])
      : (db.prepare('SELECT * FROM alarms WHERE device_id = ? ORDER BY time, id').all(deviceId) as AlarmRow[]);
  return rows.map(toDto);
}

export function getAlarm(db: DB, id: number): AlarmDto | null {
  const r = db.prepare('SELECT * FROM alarms WHERE id = ?').get(id) as AlarmRow | undefined;
  return r ? toDto(r) : null;
}

function validate(input: AlarmInput, partial: boolean): void {
  if (!partial || input.time !== undefined) {
    if (typeof input.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time)) throw new ValidationError('Heure invalide (HH:MM).');
  }
  if (input.label !== undefined && (typeof input.label !== 'string' || input.label.length > 40)) throw new ValidationError('Nom trop long (40 caractères max).');
  if (input.days !== undefined && (!Array.isArray(input.days) || input.days.length !== 7)) throw new ValidationError('Jours invalides.');
  if (input.sound !== undefined && !ALARM_SOUNDS.includes(input.sound as (typeof ALARM_SOUNDS)[number])) throw new ValidationError('Sonnerie inconnue.');
  if (input.snoozeMinutes !== undefined && (!Number.isInteger(input.snoozeMinutes) || input.snoozeMinutes < 1 || input.snoozeMinutes > 30)) {
    throw new ValidationError('Répétition entre 1 et 30 minutes.');
  }
}

export function createAlarm(db: DB, input: AlarmInput, deviceId: number | null = null): AlarmDto {
  validate(input, false);
  const res = db
    .prepare('INSERT INTO alarms (time, label, days, sound, enabled, snooze_minutes, created_at, device_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(
      input.time,
      (input.label ?? '').trim(),
      maskFromDays(input.days ?? [false, false, false, false, false, false, false]),
      input.sound ?? 'aube',
      input.enabled === false ? 0 : 1,
      input.snoozeMinutes ?? 9,
      new Date().toISOString(),
      deviceId,
    );
  return getAlarm(db, Number(res.lastInsertRowid))!;
}

export function updateAlarm(db: DB, id: number, input: AlarmInput): AlarmDto | null {
  validate(input, true);
  const sets: string[] = [];
  const values: unknown[] = [];
  if (input.time !== undefined) (sets.push('time = ?'), values.push(input.time));
  if (input.label !== undefined) (sets.push('label = ?'), values.push(input.label.trim()));
  if (input.days !== undefined) (sets.push('days = ?'), values.push(maskFromDays(input.days)));
  if (input.sound !== undefined) (sets.push('sound = ?'), values.push(input.sound));
  if (input.enabled !== undefined) (sets.push('enabled = ?'), values.push(input.enabled ? 1 : 0));
  if (input.snoozeMinutes !== undefined) (sets.push('snooze_minutes = ?'), values.push(input.snoozeMinutes));
  if (sets.length) db.prepare(`UPDATE alarms SET ${sets.join(', ')} WHERE id = ?`).run(...values, id);
  return getAlarm(db, id);
}

export function deleteAlarm(db: DB, id: number): boolean {
  return db.prepare('DELETE FROM alarms WHERE id = ?').run(id).changes > 0;
}

/** Prochaine sonnerie (timestamp ms) parmi les alarmes actives. */
export function nextAlarm(alarms: AlarmDto[], now = new Date()): { at: number; id: number; label: string; time: string } | null {
  let best: { at: number; id: number; label: string; time: string } | null = null;
  for (const a of alarms) {
    if (!a.enabled) continue;
    const [h, m] = a.time.split(':').map(Number);
    const oneShot = !a.days.some(Boolean);
    for (let i = 0; i < 8; i++) {
      const d = new Date(now);
      d.setDate(now.getDate() + i);
      d.setHours(h, m, 0, 0);
      if (d <= now) continue;
      const wd = (d.getDay() + 6) % 7;
      if (!oneShot && !a.days[wd]) continue;
      if (!best || d.getTime() < best.at) best = { at: d.getTime(), id: a.id, label: a.label, time: a.time };
      break;
    }
  }
  return best;
}

export interface Routine {
  enabled: boolean;
  preLightMinutes: number;
  showBriefing: boolean;
  waterReminder: boolean;
}

export const DEFAULT_ROUTINE: Routine = { enabled: true, preLightMinutes: 10, showBriefing: true, waterReminder: true };

/** Routine matinale d'un écran (à défaut, celle de l'ancienne installation mono-écran). */
export function getRoutine(db: DB, deviceId: number): Routine {
  const legacy = getSetting<Partial<Routine>>(db, 'routine', {});
  return { ...DEFAULT_ROUTINE, ...legacy, ...getSetting<Partial<Routine>>(db, `routine:${deviceId}`, {}) };
}

export function saveRoutine(db: DB, deviceId: number, input: Partial<Routine>): Routine {
  const next = { ...getRoutine(db, deviceId) };
  if (input.enabled !== undefined) next.enabled = !!input.enabled;
  if (input.showBriefing !== undefined) next.showBriefing = !!input.showBriefing;
  if (input.waterReminder !== undefined) next.waterReminder = !!input.waterReminder;
  if (input.preLightMinutes !== undefined) {
    const v = Number(input.preLightMinutes);
    if (!Number.isInteger(v) || v < 0 || v > 30) throw new ValidationError('Pré-éclairage entre 0 et 30 minutes.');
    next.preLightMinutes = v;
  }
  setSetting(db, `routine:${deviceId}`, next);
  return next;
}
