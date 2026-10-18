import type { DB } from '../db.js';
import { getCache } from '../db.js';
import { decryptJson, encryptJson, previewSecret } from '../crypto.js';
import { logEvent } from '../events.js';
import { errorMessage } from '../http.js';
import { icloud } from './icloud.js';
import { pathe } from './pathe.js';
import { roblox } from './roblox.js';
import { spotify } from './spotify.js';
import { ConfigError, type IntegrationContext, type IntegrationDef, type IntegrationId, type IntegrationStatus } from './types.js';
import { weather } from './weather.js';
import { household, householdIdOf, listHouseholds, mainOrNull } from '../households.js';
import { appCredentials, serviceAvailable } from '../services.js';

export const INTEGRATIONS: IntegrationDef[] = [spotify, roblox, pathe, icloud, weather];

interface Row {
  id: string;
  enabled: number;
  config: string;
  secrets_enc: string | null;
  status: IntegrationStatus;
  status_detail: string;
  last_run_at: string | null;
}

export function getDef(id: string): IntegrationDef | undefined {
  return INTEGRATIONS.find((d) => d.id === id);
}

function ensureRows(db: DB): void {
  const insert = db.prepare('INSERT OR IGNORE INTO integrations (id, enabled, config) VALUES (?, 0, ?)');
  for (const def of INTEGRATIONS) insert.run(def.id, JSON.stringify(def.defaults));
}

function getRow(db: DB, id: string): Row {
  ensureRows(db);
  return db.prepare('SELECT * FROM integrations WHERE id = ?').get(id) as Row;
}

export function makeContext(db: DB, id: IntegrationId): IntegrationContext {
  const def = getDef(id)!;
  const row = getRow(db, id);
  const m = mainOrNull();
  const ctx: IntegrationContext = {
    db,
    householdId: householdIdOf(db),
    app: m ? appCredentials(m, id) : {},
    config: { ...def.defaults, ...safeParse(row.config) },
    secrets: decryptJson<Record<string, string>>(row.secrets_enc, {}),
    saveConfig(patch) {
      Object.assign(ctx.config, patch);
      db.prepare('UPDATE integrations SET config = ? WHERE id = ?').run(JSON.stringify(ctx.config), id);
    },
    saveSecrets(patch) {
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === '') delete ctx.secrets[k];
        else ctx.secrets[k] = v;
      }
      db.prepare('UPDATE integrations SET secrets_enc = ? WHERE id = ?').run(encryptJson(ctx.secrets), id);
    },
    log(level, message) {
      logEvent(db, id, level, message);
    },
  };
  return ctx;
}

function safeParse(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

/** Service proposé par l'administrateur (tous le sont tant qu'il n'en a pas retiré). */
export function isAvailable(id: string): boolean {
  const m = mainOrNull();
  return m ? serviceAvailable(m, id) : true;
}

export function isEnabled(db: DB, id: IntegrationId): boolean {
  return isAvailable(id) && !!getRow(db, id).enabled;
}

export function toDto(db: DB, def: IntegrationDef) {
  const row = getRow(db, def.id);
  const ctx = makeContext(db, def.id);
  const secrets: Record<string, { set: boolean; preview: string }> = {};
  for (const key of def.secretFields) secrets[key] = { set: !!ctx.secrets[key], preview: previewSecret(ctx.secrets[key] ?? '') };
  const missing = def.missing(ctx);
  let status: IntegrationStatus = row.status;
  let detail = row.status_detail;
  if (!row.enabled) {
    status = 'disabled';
    detail = missing ? `Désactivé · ${missing}` : 'Désactivé';
  } else if (missing) {
    status = 'warning';
    detail = `À configurer · ${missing}`;
  } else if (!row.last_run_at) {
    detail = detail || 'En attente de la première mise à jour';
  }
  return {
    id: def.id,
    name: def.name,
    description: def.description,
    enabled: !!row.enabled,
    status,
    statusDetail: detail,
    lastRunAt: row.last_run_at,
    config: { ...ctx.config, ...(def.computed?.(ctx) ?? {}) },
    secrets,
    fields: def.fields(ctx),
    actions: def.actions?.(ctx) ?? [],
  };
}

export function listIntegrations(db: DB) {
  return INTEGRATIONS.filter((def) => isAvailable(def.id)).map((def) => toDto(db, def));
}

export function updateIntegration(
  db: DB,
  id: IntegrationId,
  body: { enabled?: unknown; config?: unknown; secrets?: unknown },
): void {
  const def = getDef(id);
  if (!def) throw new ConfigError('Intégration inconnue.');
  const ctx = makeContext(db, id);
  if (body.config !== undefined) {
    if (!body.config || typeof body.config !== 'object' || Array.isArray(body.config)) throw new ConfigError('Configuration invalide.');
    const clean = def.sanitizeConfig(body.config as Record<string, unknown>, ctx.config);
    // Pathé : retrouve le nom du cinéma à partir de la liste en cache.
    if (id === 'pathe' && typeof clean.cinemaId === 'string' && !clean.cinemaName) {
      const list = getCache<{ id: string; name: string }[]>(db, 'pathe_cinemas')?.value ?? [];
      clean.cinemaName = list.find((c) => c.id === clean.cinemaId)?.name ?? clean.cinemaId;
    }
    ctx.saveConfig(clean);
  }
  if (body.secrets !== undefined) {
    if (!body.secrets || typeof body.secrets !== 'object') throw new ConfigError('Secrets invalides.');
    const patch: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(body.secrets as Record<string, unknown>)) {
      if (!def.secretFields.includes(k)) throw new ConfigError(`Champ secret inconnu : ${k}`);
      if (v !== null && (typeof v !== 'string' || v.length > 500)) throw new ConfigError('Valeur secrète invalide.');
      patch[k] = v === null ? null : (v as string).trim();
    }
    ctx.saveSecrets(patch);
  }
  if (body.enabled !== undefined) {
    db.prepare('UPDATE integrations SET enabled = ? WHERE id = ?').run(body.enabled ? 1 : 0, id);
    logEvent(db, id, 'info', `${def.name} ${body.enabled ? 'activé' : 'désactivé'}`);
  }
  // Force une nouvelle exécution au prochain passage du planificateur.
  db.prepare('UPDATE integrations SET last_run_at = NULL WHERE id = ?').run(id);
}

const running = new Set<string>();

export async function runIntegration(db: DB, id: IntegrationId, reason = 'auto'): Promise<{ ok: boolean; message: string }> {
  const def = getDef(id)!;
  const key = `${householdIdOf(db)}:${id}`;
  if (running.has(key)) return { ok: false, message: 'Mise à jour déjà en cours' };
  if (!isAvailable(id)) return { ok: false, message: 'Service désactivé par l’administrateur' };
  const row = getRow(db, id);
  const ctx = makeContext(db, id);
  const missing = def.missing(ctx);
  if (!row.enabled || missing) return { ok: false, message: missing ?? 'Intégration désactivée' };
  running.add(key);
  try {
    const result = await withTimeout(def.run(ctx), 120_000);
    db.prepare('UPDATE integrations SET status = ?, status_detail = ?, last_run_at = ? WHERE id = ?').run(
      result.status,
      result.detail,
      new Date().toISOString(),
      id,
    );
    if (row.status !== result.status || reason !== 'auto') {
      logEvent(db, id, result.status === 'ok' ? 'success' : 'warning', `${def.name} : ${result.detail}`);
    }
    return { ok: true, message: result.detail };
  } catch (err) {
    const msg = errorMessage(err);
    const time = new Date().toTimeString().slice(0, 5);
    db.prepare('UPDATE integrations SET status = ?, status_detail = ?, last_run_at = ? WHERE id = ?').run(
      'error',
      `Échec à ${time} · ${msg}`,
      new Date().toISOString(),
      id,
    );
    if (row.status !== 'error' || reason !== 'auto') logEvent(db, id, 'error', `${def.name} : ${msg}`);
    return { ok: false, message: msg };
  } finally {
    running.delete(key);
  }
}

export async function testIntegration(db: DB, id: IntegrationId): Promise<{ ok: boolean; ms: number; message: string }> {
  const def = getDef(id)!;
  const ctx = makeContext(db, id);
  const missing = def.missing(ctx);
  if (missing) return { ok: false, ms: 0, message: missing };
  const t0 = Date.now();
  try {
    const message = await withTimeout(def.test(ctx), 30_000);
    return { ok: true, ms: Date.now() - t0, message };
  } catch (err) {
    return { ok: false, ms: Date.now() - t0, message: errorMessage(err) };
  }
}

/** Lance ce qui est dû pour un foyer (et réessaie les erreurs après 15 min). */
export async function tick(db: DB): Promise<void> {
  ensureRows(db);
  const now = new Date();
  const rows = db.prepare('SELECT * FROM integrations WHERE enabled = 1').all() as Row[];
  await Promise.all(
    rows.map(async (row) => {
      const def = getDef(row.id);
      if (!def || !isAvailable(def.id)) return;
      const last = row.last_run_at ? new Date(row.last_run_at) : null;
      const ctx = makeContext(db, def.id);
      const retry = row.status === 'error' && last && now.getTime() - last.getTime() > 15 * 60_000;
      if (retry || def.isDue(ctx, last, now)) await runIntegration(db, def.id);
    }),
  );
}

/** Appelé toutes les 15 s par le serveur : tous les foyers, l'un après l'autre. */
export async function tickAll(onError: (err: unknown, householdId: number) => void): Promise<void> {
  for (const h of listHouseholds()) {
    try {
      await tick(household(h.id));
    } catch (err) {
      onError(err, h.id);
    }
  }
}

export async function runAll(db: DB): Promise<void> {
  await Promise.all(INTEGRATIONS.filter((d) => isAvailable(d.id)).map((d) => runIntegration(db, d.id, 'manual')));
}

export function servicesSummary(db: DB) {
  return listIntegrations(db).map((i) => ({ id: i.id, name: i.name, status: i.status, detail: i.statusDetail }));
}

export function revealSecret(db: DB, id: IntegrationId, field: string): string {
  const def = getDef(id);
  if (!def || !def.secretFields.includes(field)) throw new ConfigError('Champ secret inconnu.');
  const value = makeContext(db, id).secrets[field] ?? '';
  logEvent(db, id, 'info', `Secret « ${field} » affiché dans la console`);
  return value;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Délai dépassé')), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
}

export { ConfigError };
export type { IntegrationId };
