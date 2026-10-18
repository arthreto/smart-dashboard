// Ouverture des bases au démarrage, et reprise automatique d'une installation de la
// version précédente (un seul compte, un seul écran, tout dans smart-dashboard.db) :
// elle devient le foyer n° 1, son compte devient l'administrateur « admin ».
import fs from 'node:fs';
import path from 'node:path';
import type { DB } from './db.js';
import { getSetting, openDb, openMainDb } from './db.js';
import { config } from './config.js';
import { decryptJson, encryptJson, hashPassword } from './crypto.js';
import { logEvent } from './events.js';
import { setMain } from './households.js';
import { importAppCredentials } from './services.js';
import { AuthError, createUserWithHousehold, findUserByLogin, validateLogin, validatePasswordStrength, type UserRow } from './auth.js';

export const LEGACY_ADMIN_LOGIN = 'admin';

export function openMain(dataDir = config.dataDir): DB {
  const db = openMainDb(path.join(dataDir, 'main.db'));
  setMain(db, path.join(dataDir, 'households'));
  migrateLegacy(db, dataDir);
  return db;
}

interface LegacyAdmin {
  password_hash: string;
  totp_secret_enc: string | null;
  totp_pending_enc: string | null;
  totp_enabled: number;
  created_at: string;
}

interface LegacyDevice {
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

/** Reprend smart-dashboard.db (ancienne version) s'il existe et qu'aucun foyer n'existe encore. */
export function migrateLegacy(db: DB, dataDir: string): boolean {
  const legacyFile = path.join(dataDir, 'smart-dashboard.db');
  if (!fs.existsSync(legacyFile)) return false;
  if ((db.prepare('SELECT COUNT(*) AS n FROM households').get() as { n: number }).n > 0) return false;

  // L'ancienne base a le schéma d'un foyer (migration 1) : on l'ouvre comme tel, ce qui
  // lui applique les migrations suivantes (réveils rattachés à un écran…).
  const legacy = openDb(legacyFile);
  const tableExists = (name: string) => !!legacy.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
  const admin = tableExists('admin') ? (legacy.prepare('SELECT * FROM admin WHERE id = 1').get() as LegacyAdmin | undefined) : undefined;
  const device = tableExists('device') ? (legacy.prepare('SELECT * FROM device WHERE id = 1').get() as LegacyDevice | undefined) : undefined;
  const spotifyRow = legacy.prepare("SELECT config, secrets_enc FROM integrations WHERE id = 'spotify'").get() as
    | { config: string; secrets_enc: string | null }
    | undefined;
  const now = new Date().toISOString();

  db.transaction(() => {
    db.prepare("INSERT INTO households (id, name, created_at) VALUES (1, 'Mon foyer', ?)").run(admin?.created_at ?? now);
    if (admin) {
      db.prepare(
        "INSERT INTO users (login, name, role, household_id, password_hash, totp_secret_enc, totp_pending_enc, totp_enabled, created_at) VALUES (?, '', 'admin', 1, ?, ?, ?, ?, ?)",
      ).run(LEGACY_ADMIN_LOGIN, admin.password_hash, admin.totp_secret_enc, admin.totp_pending_enc, admin.totp_enabled ? 1 : 0, admin.created_at);
    }
    if (device?.token_hash) {
      const display = getSetting<Record<string, unknown>>(legacy, 'display', {});
      const layout = getSetting<unknown[] | null>(legacy, 'layout', null);
      db.prepare(
        `INSERT INTO devices (id, household_id, name, token_hash, created_at, paired_at, last_seen_at, last_sync_at, battery, charging, firmware, rssi, ip, screen, display, layout)
         VALUES (1, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        (device.name || 'Tab5').slice(0, 40),
        device.token_hash,
        device.paired_at ?? now,
        device.paired_at,
        device.last_seen_at,
        device.last_sync_at,
        device.battery,
        device.charging,
        device.firmware,
        device.rssi,
        device.ip,
        device.screen,
        JSON.stringify(display),
        layout ? JSON.stringify(layout) : null,
      );
    }
    // L'app Spotify devient celle du serveur (le compte connecté reste celui du foyer).
    if (spotifyRow) {
      const cfg = safeJson(spotifyRow.config);
      const secrets = decryptJson<Record<string, string>>(spotifyRow.secrets_enc, {});
      if (cfg.clientId || secrets.clientSecret) {
        importAppCredentials(db, 'spotify', { clientId: String(cfg.clientId ?? '') }, secrets.clientSecret ? { clientSecret: secrets.clientSecret } : {});
      }
    }
  })();

  if (device?.token_hash) {
    legacy.prepare('UPDATE alarms SET device_id = 1 WHERE device_id IS NULL').run();
    legacy.prepare('UPDATE commands SET device_id = 1 WHERE device_id IS NULL').run();
  }
  if (spotifyRow) {
    const cfg = safeJson(spotifyRow.config);
    delete cfg.clientId;
    const secrets = decryptJson<Record<string, string>>(spotifyRow.secrets_enc, {});
    delete secrets.clientSecret;
    legacy.prepare("UPDATE integrations SET config = ?, secrets_enc = ? WHERE id = 'spotify'").run(JSON.stringify(cfg), encryptJson(secrets));
  }
  legacy.pragma('wal_checkpoint(TRUNCATE)');
  legacy.close();

  const target = path.join(dataDir, 'households', '1.db');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.renameSync(legacyFile, target);
  for (const suffix of ['-wal', '-shm']) fs.rmSync(legacyFile + suffix, { force: true });
  const shot = path.join(dataDir, 'screenshot.jpg');
  if (fs.existsSync(shot) && device?.token_hash) {
    fs.mkdirSync(path.join(dataDir, 'screens'), { recursive: true });
    fs.renameSync(shot, path.join(dataDir, 'screens', '1.jpg'));
  }
  logEvent(
    db,
    'server',
    'success',
    `Ancienne installation reprise : foyer « Mon foyer »${admin ? `, compte administrateur « ${LEGACY_ADMIN_LOGIN} »` : ''}${device?.token_hash ? ', écran associé conservé' : ''}`,
  );
  return true;
}

function safeJson(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

/**
 * Premier compte administrateur. Si un foyer existe déjà sans compte (ancienne installation
 * jamais configurée), il lui est rattaché ; sinon un nouveau foyer est créé.
 */
export function createFirstAdmin(db: DB, login: string, password: string, name = ''): UserRow {
  const loginErr = validateLogin(login);
  if (loginErr) throw new AuthError(loginErr);
  const pwErr = validatePasswordStrength(password);
  if (pwErr) throw new AuthError(pwErr);
  if (findUserByLogin(db, login)) throw new AuthError('Cet identifiant est déjà utilisé.');
  const orphan = db.prepare('SELECT h.id FROM households h WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.household_id = h.id) ORDER BY h.id LIMIT 1').get() as
    | { id: number }
    | undefined;
  if (!orphan) return createUserWithHousehold(db, { login, password, name, role: 'admin', householdName: 'Mon foyer' });
  const res = db
    .prepare("INSERT INTO users (login, name, role, household_id, password_hash, created_at) VALUES (?, ?, 'admin', ?, ?, ?)")
    .run(login.trim(), name.trim().slice(0, 60), orphan.id, hashPassword(password), new Date().toISOString());
  return db.prepare('SELECT * FROM users WHERE id = ?').get(Number(res.lastInsertRowid)) as UserRow;
}
