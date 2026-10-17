import type { DB } from './db.js';

export type EventLevel = 'info' | 'success' | 'warning' | 'error';

export interface EventRow {
  id: number;
  ts: string;
  source: string;
  level: EventLevel;
  message: string;
}

const MAX_EVENTS = 2000;

export function logEvent(db: DB, source: string, level: EventLevel, message: string): void {
  db.prepare('INSERT INTO events (ts, source, level, message) VALUES (?, ?, ?, ?)').run(
    new Date().toISOString(),
    source,
    level,
    message.slice(0, 500),
  );
  // Rotation douce du journal.
  db.prepare('DELETE FROM events WHERE id <= (SELECT MAX(id) FROM events) - ?').run(MAX_EVENTS);
}

export function recentEvents(db: DB, limit = 50): EventRow[] {
  return db.prepare('SELECT id, ts, source, level, message FROM events ORDER BY id DESC LIMIT ?').all(limit) as EventRow[];
}
