// Foyers : chacun a sa propre base SQLite (households/<id>.db), ouverte à la demande et
// gardée ouverte. La base principale (comptes, écrans…) est accessible partout via main().
import fs from 'node:fs';
import path from 'node:path';
import type { DB } from './db.js';
import { openDb } from './db.js';
import { config } from './config.js';
import { seedDefaults } from './seed.js';

let mainDb: DB | null = null;
let householdsDir = path.join(config.dataDir, 'households');
const pool = new Map<number, DB>();
const idOf = new WeakMap<DB, number>();

/** Déclare la base principale (au démarrage, ou dans les tests). */
export function setMain(db: DB, dir = path.join(config.dataDir, 'households')): void {
  mainDb = db;
  householdsDir = dir;
}

export function main(): DB {
  if (!mainDb) throw new Error('Base principale non initialisée');
  return mainDb;
}

export function mainOrNull(): DB | null {
  return mainDb;
}

export function householdFile(id: number): string {
  return path.join(householdsDir, `${id}.db`);
}

/** Base du foyer `id` (ouverte au premier accès). */
export function household(id: number): DB {
  if (!Number.isInteger(id) || id <= 0) throw new Error(`Foyer invalide : ${id}`);
  let db = pool.get(id);
  if (!db) {
    // Un foyer supprimé ne doit pas renaître sous forme de base vide (tâche en cours, retour OAuth…).
    const m = mainOrNull();
    if (m && !m.prepare('SELECT 1 FROM households WHERE id = ?').get(id)) throw new Error(`Foyer introuvable : ${id}`);
    db = openDb(householdFile(id));
    pool.set(id, db);
    idOf.set(db, id);
  }
  return db;
}

/** Identifiant du foyer d'une base (0 pour une base hors foyer, ex. tests en mémoire). */
export function householdIdOf(db: DB): number {
  return idOf.get(db) ?? 0;
}

export interface HouseholdRow {
  id: number;
  name: string;
  created_at: string;
}

export function listHouseholds(): HouseholdRow[] {
  return main().prepare('SELECT id, name, created_at FROM households ORDER BY id').all() as HouseholdRow[];
}

export function getHousehold(id: number): HouseholdRow | undefined {
  return main().prepare('SELECT id, name, created_at FROM households WHERE id = ?').get(id) as HouseholdRow | undefined;
}

/** Crée un foyer et sa base, avec les habitudes et réveils d'exemple. */
export function createHousehold(name: string): number {
  const clean = name.trim().slice(0, 60) || 'Mon foyer';
  const res = main().prepare('INSERT INTO households (name, created_at) VALUES (?, ?)').run(clean, new Date().toISOString());
  const id = Number(res.lastInsertRowid);
  seedDefaults(household(id));
  return id;
}

/**
 * Foyer utilisable : faux si tous ses comptes ont été désactivés par l'administrateur
 * (ses écrans et ses services s'arrêtent alors aussi). Un foyer sans compte (reprise de
 * l'ancienne version avant la création de l'administrateur) reste actif.
 */
export function householdActive(id: number): boolean {
  const r = main().prepare('SELECT COUNT(*) AS n, SUM(CASE WHEN disabled = 0 THEN 1 ELSE 0 END) AS active FROM users WHERE household_id = ?').get(id) as {
    n: number;
    active: number | null;
  };
  return r.n === 0 || (r.active ?? 0) > 0;
}

export function renameHousehold(id: number, name: string): void {
  const clean = name.trim().slice(0, 60);
  if (!clean) return;
  main().prepare('UPDATE households SET name = ? WHERE id = ?').run(clean, id);
}

/** Supprime un foyer : comptes, écrans (cascade) et sa base de données. */
export function deleteHousehold(id: number): void {
  const db = pool.get(id);
  if (db) {
    db.close();
    pool.delete(id);
  }
  main().prepare('DELETE FROM households WHERE id = ?').run(id);
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(householdFile(id) + suffix, { force: true });
}

export function closeAll(): void {
  for (const db of pool.values()) db.close();
  pool.clear();
  mainDb?.close();
  mainDb = null;
}
