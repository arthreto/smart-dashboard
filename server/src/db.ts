import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from './config.js';

export type DB = Database.Database;

const MIGRATIONS: string[] = [
  // 1 — schéma initial
  `
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

  CREATE TABLE admin (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    password_hash TEXT NOT NULL,
    totp_secret_enc TEXT,
    totp_pending_enc TEXT,
    totp_enabled INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    user_agent TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

  CREATE TABLE habits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
    icon TEXT NOT NULL,
    color TEXT NOT NULL CHECK (color GLOB '#[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]'),
    days INTEGER NOT NULL CHECK (days BETWEEN 1 AND 127),
    goal TEXT NOT NULL DEFAULT '',
    remind_times TEXT NOT NULL DEFAULT '[]',
    show_on_device INTEGER NOT NULL DEFAULT 1 CHECK (show_on_device IN (0, 1)),
    archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE habit_logs (
    habit_id INTEGER NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    done_at TEXT NOT NULL,
    PRIMARY KEY (habit_id, date)
  );
  CREATE INDEX habit_logs_date ON habit_logs(date);

  CREATE TABLE alarms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    time TEXT NOT NULL CHECK (time GLOB '[0-2][0-9]:[0-5][0-9]'),
    label TEXT NOT NULL DEFAULT '',
    days INTEGER NOT NULL DEFAULT 0 CHECK (days BETWEEN 0 AND 127),
    sound TEXT NOT NULL DEFAULT 'aube',
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    snooze_minutes INTEGER NOT NULL DEFAULT 9 CHECK (snooze_minutes BETWEEN 1 AND 30),
    created_at TEXT NOT NULL
  );

  CREATE TABLE integrations (
    id TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
    config TEXT NOT NULL DEFAULT '{}',
    secrets_enc TEXT,
    status TEXT NOT NULL DEFAULT 'disabled',
    status_detail TEXT NOT NULL DEFAULT '',
    last_run_at TEXT
  );

  CREATE TABLE cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, fetched_at TEXT NOT NULL);

  CREATE TABLE roblox_samples (ts INTEGER PRIMARY KEY, playing INTEGER NOT NULL);

  CREATE TABLE events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    source TEXT NOT NULL,
    level TEXT NOT NULL CHECK (level IN ('info', 'success', 'warning', 'error')),
    message TEXT NOT NULL
  );
  CREATE INDEX events_ts ON events(ts);

  CREATE TABLE device (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    name TEXT NOT NULL DEFAULT 'Tab5',
    token_hash TEXT,
    paired_at TEXT,
    last_seen_at TEXT,
    last_sync_at TEXT,
    battery INTEGER,
    charging INTEGER,
    firmware TEXT,
    rssi INTEGER,
    ip TEXT,
    screen TEXT
  );
  INSERT INTO device (id) VALUES (1);

  CREATE TABLE pairing_codes (code_hash TEXT PRIMARY KEY, expires_at TEXT NOT NULL);

  CREATE TABLE commands (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    text TEXT,
    created_at TEXT NOT NULL,
    acked_at TEXT
  );

  CREATE TABLE cinema_alerts (film_id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', notified INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
  `,
];

export function openDb(file = path.join(config.dataDir, 'smart-dashboard.db')): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return db;
}

function migrate(db: DB): void {
  const version = db.pragma('user_version', { simple: true }) as number;
  for (let i = version; i < MIGRATIONS.length; i++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[i]);
      db.pragma(`user_version = ${i + 1}`);
    })();
  }
}

/** Petit helper pour les réglages JSON clé/valeur. */
export function getSetting<T>(db: DB, key: string, fallback: T): T {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export function setSetting(db: DB, key: string, value: unknown): void {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    key,
    JSON.stringify(value),
  );
}

export function getCache<T>(db: DB, key: string): { value: T; fetchedAt: string } | null {
  const row = db.prepare('SELECT value, fetched_at FROM cache WHERE key = ?').get(key) as
    | { value: string; fetched_at: string }
    | undefined;
  if (!row) return null;
  try {
    return { value: JSON.parse(row.value) as T, fetchedAt: row.fetched_at };
  } catch {
    return null;
  }
}

export function setCache(db: DB, key: string, value: unknown): void {
  db.prepare(
    'INSERT INTO cache (key, value, fetched_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, fetched_at = excluded.fetched_at',
  ).run(key, JSON.stringify(value), new Date().toISOString());
}

export function deleteCache(db: DB, key: string): void {
  db.prepare('DELETE FROM cache WHERE key = ?').run(key);
}
