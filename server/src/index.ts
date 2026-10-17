import { config } from './config.js';
import { openDb } from './db.js';
import { masterKey } from './crypto.js';
import { buildApp } from './app.js';
import { tick } from './integrations/index.js';
import { purgeExpiredSessions } from './auth.js';
import { pruneImageCache } from './images.js';
import { logEvent } from './events.js';

async function main() {
  masterKey(); // crée ou vérifie la clé de chiffrement dès le démarrage
  const db = openDb();
  const app = await buildApp(db);

  await app.listen({ port: config.port, host: config.host });
  app.log.info(`Smart Dashboard prêt sur ${config.publicUrl} (écoute ${config.host}:${config.port}, fuseau ${config.tz})`);
  logEvent(db, 'server', 'info', 'Serveur démarré');

  // Planificateur des intégrations : vérifie toutes les 15 s ce qui doit être rafraîchi.
  let busy = false;
  const run = async () => {
    if (busy) return;
    busy = true;
    try {
      await tick(db);
    } catch (err) {
      app.log.error(err, 'tick');
    } finally {
      busy = false;
    }
  };
  setTimeout(run, 2000);
  const timer = setInterval(run, 15_000);
  const housekeeping = setInterval(() => {
    purgeExpiredSessions(db);
    void pruneImageCache();
  }, 6 * 3600_000);

  const shutdown = async (signal: string) => {
    app.log.info(`Arrêt (${signal})`);
    clearInterval(timer);
    clearInterval(housekeeping);
    await app.close();
    db.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
