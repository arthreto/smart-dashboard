import type { DB } from './db.js';
import { ValidationError } from './habits.js';
import { logEvent } from './events.js';

const VERSION = 1;

/** Export complet hors secrets (clés API, mot de passe, jetons). */
export function exportBackup(db: DB) {
  return {
    format: 'smart-dashboard-backup',
    version: VERSION,
    exportedAt: new Date().toISOString(),
    habits: db.prepare('SELECT * FROM habits ORDER BY id').all(),
    habitLogs: db.prepare('SELECT * FROM habit_logs ORDER BY date').all(),
    alarms: db.prepare('SELECT * FROM alarms ORDER BY id').all(),
    settings: db.prepare("SELECT key, value FROM settings WHERE key NOT IN ('pin')").all(),
    integrations: db.prepare('SELECT id, enabled, config FROM integrations').all(),
    cinemaAlerts: db.prepare('SELECT * FROM cinema_alerts').all(),
  };
}

type Rec = Record<string, unknown>;

export function importBackup(db: DB, data: unknown): void {
  const d = data as Rec;
  if (!d || d.format !== 'smart-dashboard-backup' || d.version !== VERSION) throw new ValidationError('Fichier de sauvegarde non reconnu.');
  const arr = (k: string) => (Array.isArray(d[k]) ? (d[k] as Rec[]) : []);
  db.transaction(() => {
    db.prepare('DELETE FROM habit_logs').run();
    db.prepare('DELETE FROM habits').run();
    db.prepare('DELETE FROM alarms').run();
    const ih = db.prepare(
      'INSERT INTO habits (id, name, icon, color, days, goal, remind_times, show_on_device, archived, position, created_at) VALUES (@id, @name, @icon, @color, @days, @goal, @remind_times, @show_on_device, @archived, @position, @created_at)',
    );
    for (const h of arr('habits')) ih.run(h);
    const il = db.prepare('INSERT OR IGNORE INTO habit_logs (habit_id, date, done_at) VALUES (@habit_id, @date, @done_at)');
    for (const l of arr('habitLogs')) il.run(l);
    const ia = db.prepare(
      'INSERT INTO alarms (id, time, label, days, sound, enabled, snooze_minutes, created_at) VALUES (@id, @time, @label, @days, @sound, @enabled, @snooze_minutes, @created_at)',
    );
    for (const a of arr('alarms')) ia.run(a);
    const is = db.prepare('INSERT INTO settings (key, value) VALUES (@key, @value) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    for (const s of arr('settings')) if (s.key !== 'pin') is.run(s);
    const ii = db.prepare('UPDATE integrations SET enabled = @enabled, config = @config, last_run_at = NULL WHERE id = @id');
    for (const i of arr('integrations')) ii.run(i);
    db.prepare('DELETE FROM cinema_alerts').run();
    const ic = db.prepare('INSERT OR IGNORE INTO cinema_alerts (film_id, title, notified, created_at) VALUES (@film_id, @title, @notified, @created_at)');
    for (const c of arr('cinemaAlerts')) ic.run(c);
  })();
  logEvent(db, 'console', 'warning', 'Données restaurées depuis une sauvegarde');
}
