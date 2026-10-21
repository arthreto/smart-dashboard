import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from './config.js';

export type DB = Database.Database;

// Deux sortes de bases :
//   - la base principale (main.db) : comptes, sessions, invitations, foyers, écrans,
//     réglages globaux (clés API de l'administrateur) et journal du serveur ;
//   - une base par foyer (households/<id>.db) : habitudes, réveils, intégrations,
//     caches… Les données d'un foyer sont ainsi physiquement séparées des autres.

/** Schéma d'une base de foyer (la migration 1 est l'ancien schéma mono-utilisateur). */
const HOUSEHOLD_MIGRATIONS: string[] = [
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
  // 2 — plusieurs écrans par foyer : chaque réveil et chaque commande appartient à un écran
  // (device_id = id dans main.devices ; NULL = réveil pas encore attribué, repris par le
  // premier écran associé). Les tables « device » et « pairing_codes » ne servent plus.
  `
  ALTER TABLE alarms ADD COLUMN device_id INTEGER;
  ALTER TABLE commands ADD COLUMN device_id INTEGER;
  CREATE INDEX alarms_device ON alarms(device_id);
  CREATE INDEX commands_device ON commands(device_id);
  `,
];

const MAIN_MIGRATIONS: string[] = [
  `
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

  CREATE TABLE households (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
    created_at TEXT NOT NULL
  );

  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    login TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (length(login) BETWEEN 3 AND 120),
    name TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
    household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    password_hash TEXT NOT NULL,
    totp_secret_enc TEXT,
    totp_pending_enc TEXT,
    totp_enabled INTEGER NOT NULL DEFAULT 0 CHECK (totp_enabled IN (0, 1)),
    disabled INTEGER NOT NULL DEFAULT 0 CHECK (disabled IN (0, 1)),
    created_at TEXT NOT NULL,
    last_login_at TEXT
  );
  CREATE INDEX users_household ON users(household_id);

  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_agent TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE INDEX sessions_user ON sessions(user_id);

  -- Liens à usage unique : invitation (création d'un compte et de son foyer) ou
  -- réinitialisation du mot de passe d'un compte existant.
  CREATE TABLE invites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL CHECK (kind IN ('invite', 'reset')),
    token_hash TEXT NOT NULL UNIQUE,
    note TEXT NOT NULL DEFAULT '',
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    used_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    CHECK ((kind = 'reset') = (user_id IS NOT NULL))
  );

  CREATE TABLE devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    name TEXT NOT NULL DEFAULT 'Tab5' CHECK (length(name) BETWEEN 1 AND 40),
    token_hash TEXT UNIQUE,
    created_at TEXT NOT NULL,
    paired_at TEXT,
    last_seen_at TEXT,
    last_sync_at TEXT,
    battery INTEGER,
    charging INTEGER,
    firmware TEXT,
    rssi INTEGER,
    ip TEXT,
    screen TEXT,
    display TEXT NOT NULL DEFAULT '{}',
    layout TEXT
  );
  CREATE INDEX devices_household ON devices(household_id);

  CREATE TABLE pairing_codes (
    code_hash TEXT PRIMARY KEY,
    household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    device_id INTEGER REFERENCES devices(id) ON DELETE CASCADE,
    name TEXT NOT NULL DEFAULT '',
    expires_at TEXT NOT NULL
  );

  CREATE TABLE global_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

  CREATE TABLE events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    source TEXT NOT NULL,
    level TEXT NOT NULL CHECK (level IN ('info', 'success', 'warning', 'error')),
    message TEXT NOT NULL
  );
  CREATE INDEX events_ts ON events(ts);
  `,
  // 2 — galerie : vidéos chiffrées de bout en bout. Le serveur ne garde que la clé publique
  // de chaque compte et sa clé privée chiffrée par le code secret (dérivé dans le navigateur) :
  // il ne peut déchiffrer ni la clé ni les vidéos. Les morceaux sont des fichiers
  // DATA_DIR/gallery/<compte>/<vidéo>/<n>.bin.
  `
  CREATE TABLE gallery_keys (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    public_key TEXT NOT NULL,
    private_key_enc TEXT NOT NULL,
    kdf TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE gallery_videos (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id INTEGER NOT NULL,
    device_name TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL CHECK (status IN ('waiting', 'recording', 'done', 'error', 'cancelled')),
    stop_requested INTEGER NOT NULL DEFAULT 0 CHECK (stop_requested IN (0, 1)),
    error TEXT NOT NULL DEFAULT '',
    wrapped_key TEXT,
    nonce_prefix TEXT,
    chunks INTEGER NOT NULL DEFAULT 0,
    bytes INTEGER NOT NULL DEFAULT 0,
    complete INTEGER NOT NULL DEFAULT 0 CHECK (complete IN (0, 1)),
    duration_ms INTEGER,
    created_at TEXT NOT NULL,
    started_at TEXT,
    last_chunk_at TEXT,
    ended_at TEXT
  );
  CREATE INDEX gallery_videos_user ON gallery_videos(user_id, created_at);
  CREATE INDEX gallery_videos_device ON gallery_videos(device_id, status);
  `,
];

function openWith(file: string, migrations: string[]): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db, migrations);
  return db;
}

/** Base d'un foyer (habitudes, réveils, intégrations…). */
export function openDb(file: string): DB {
  return openWith(file, HOUSEHOLD_MIGRATIONS);
}

/** Base principale : comptes, foyers, écrans, réglages globaux. */
export function openMainDb(file = path.join(config.dataDir, 'main.db')): DB {
  return openWith(file, MAIN_MIGRATIONS);
}

function migrate(db: DB, migrations: string[]): void {
  const version = db.pragma('user_version', { simple: true }) as number;
  for (let i = version; i < migrations.length; i++) {
    db.transaction(() => {
      db.exec(migrations[i]);
      db.pragma(`user_version = ${i + 1}`);
    })();
  }
}

export function getGlobal<T>(db: DB, key: string, fallback: T): T {
  const row = db.prepare('SELECT value FROM global_settings WHERE key = ?').get(key) as { value: string } | undefined;
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export function setGlobal(db: DB, key: string, value: unknown): void {
  db.prepare('INSERT INTO global_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    key,
    JSON.stringify(value),
  );
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
