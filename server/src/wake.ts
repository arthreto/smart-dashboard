// Réveil immédiat des écrans : chaque tablette garde une requête GET /api/v1/wait ouverte
// (attente longue, 25 s au plus). Quand la console lui envoie quelque chose (commande,
// enregistrement, réglages), la requête se termine aussitôt et l'écran relit son état,
// au lieu d'attendre sa prochaine synchronisation (60 s par défaut).

const waiters = new Map<number, Set<(woken: boolean) => void>>();

/** Réveille les requêtes en attente de cet écran. */
export function wakeDevice(deviceId: number): void {
  const set = waiters.get(deviceId);
  if (!set) return;
  waiters.delete(deviceId);
  for (const fn of set) fn(true);
}

/** Attend un réveil (true) ou la fin du délai / la fermeture de la connexion (false). */
export function waitForWake(deviceId: number, timeoutMs: number, onClose: (cb: () => void) => void): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    let set = waiters.get(deviceId);
    if (!set) {
      set = new Set();
      waiters.set(deviceId, set);
    }
    const finish = (woken: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const s = waiters.get(deviceId);
      if (s) {
        s.delete(finish);
        if (s.size === 0) waiters.delete(deviceId);
      }
      resolve(woken);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    set.add(finish);
    onClose(() => finish(false));
  });
}

/** Nombre de requêtes en attente (tests). */
export function waitingCount(deviceId: number): number {
  return waiters.get(deviceId)?.size ?? 0;
}
