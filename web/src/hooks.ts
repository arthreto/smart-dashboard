import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage } from './api';

export interface ApiData<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => Promise<void>;
  setData: React.Dispatch<React.SetStateAction<T | null>>;
}

/**
 * Charge une route GET au montage (et quand `path` change).
 * `reload()` relance la requête sans vider les données affichées.
 */
export function useApiData<T>(path: string | null, opts: { intervalMs?: number } = {}): ApiData<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(path !== null);
  const controllerRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    if (path === null) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const result = await api.get<T>(path, controller.signal);
      if (controller.signal.aborted) return;
      setData(result);
      setError(null);
    } catch (err) {
      if (controller.signal.aborted) return;
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(errorMessage(err));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    setLoading(path !== null);
    void load();
    return () => controllerRef.current?.abort();
  }, [load, path]);

  useEffect(() => {
    if (!opts.intervalMs || path === null) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, opts.intervalMs);
    return () => window.clearInterval(id);
  }, [load, opts.intervalMs, path]);

  return { data, error, loading, reload: load, setData };
}

/** Horloge qui se met à jour (pour « il y a 12 s »). */
export function useNow(intervalMs = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** Exécute une action asynchrone avec un indicateur « en cours ». */
export function useBusy(): [boolean, <R>(fn: () => Promise<R>) => Promise<R | undefined>] {
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const run = useCallback(async <R,>(fn: () => Promise<R>) => {
    setBusy(true);
    try {
      return await fn();
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, []);
  return [busy, run];
}

export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} · Smart Dashboard`;
  }, [title]);
}

/** Copie dans le presse-papiers avec repli pour les contextes non sécurisés. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* repli ci-dessous */
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}
