/** Ressource absente (ou appartenant à un autre foyer) : réponse 404. */
export class NotFoundError extends Error {}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    message?: string,
  ) {
    super(message ?? `HTTP ${status}`);
  }
}

export interface FetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string | URLSearchParams;
  timeoutMs?: number;
}

export async function fetchRaw(url: string, opts: FetchOptions = {}): Promise<Response> {
  const res = await fetch(url, {
    method: opts.method ?? 'GET',
    headers: opts.headers,
    body: opts.body,
    signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
    redirect: 'follow',
  });
  return res;
}

export async function fetchJson<T>(url: string, opts: FetchOptions = {}): Promise<T> {
  const res = await fetchRaw(url, { ...opts, headers: { Accept: 'application/json', ...(opts.headers ?? {}) } });
  const text = await res.text();
  if (!res.ok) throw new HttpError(res.status, text.slice(0, 500), `HTTP ${res.status} sur ${new URL(url).host}`);
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(res.status, text.slice(0, 200), `Réponse non JSON de ${new URL(url).host}`);
  }
}

/** Exécute `fn` sur chaque élément avec au plus `concurrency` appels simultanés. */
export async function mapLimit<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return out;
}

export function errorMessage(err: unknown): string {
  if (err instanceof HttpError) return err.message;
  if (err instanceof Error) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') return 'Délai dépassé';
    return err.message;
  }
  return String(err);
}
