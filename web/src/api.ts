// Petit client fetch pour l'API de la console (cookie de session + en-tête anti-CSRF).

const CSRF_HEADER = 'X-Requested-With';
const CSRF_VALUE = 'smart-dashboard';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

type UnauthorizedHandler = () => void;
let onUnauthorized: UnauthorizedHandler | null = null;

/** Appelé quand une route protégée répond 401 (session expirée) : retour à l'écran de connexion. */
export function setUnauthorizedHandler(fn: UnauthorizedHandler | null): void {
  onUnauthorized = fn;
}

const FALLBACK_MESSAGES: Record<number, string> = {
  400: 'Requête invalide.',
  401: 'Ta session a expiré. Reconnecte-toi.',
  403: 'Action refusée.',
  404: 'Introuvable.',
  409: 'Conflit : les données ont changé entre-temps.',
  413: 'Fichier trop volumineux.',
  429: 'Trop de tentatives. Réessaie dans quelques minutes.',
  500: 'Erreur du serveur.',
  502: 'Le service externe ne répond pas.',
  503: 'Service momentanément indisponible.',
};

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  /** Ne pas déclencher le retour à la connexion sur 401 (routes d'authentification). */
  skipAuthRedirect?: boolean;
}

async function parseError(res: Response): Promise<ApiError> {
  let code = `http_${res.status}`;
  let message = FALLBACK_MESSAGES[res.status] ?? `Erreur ${res.status}.`;
  try {
    const data = (await res.json()) as { error?: unknown; message?: unknown };
    if (typeof data.error === 'string') code = data.error;
    if (typeof data.message === 'string' && data.message.trim()) message = data.message;
  } catch {
    /* corps non JSON : on garde le message générique */
  }
  return new ApiError(res.status, code, message);
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (method !== 'GET') headers[CSRF_HEADER] = CSRF_VALUE;

  let body: BodyInit | undefined;
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }

  let res: Response;
  try {
    res = await fetch(path, { method, headers, body, credentials: 'same-origin', signal: opts.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError(0, 'network', 'Impossible de joindre le serveur. Vérifie ta connexion.');
  }

  if (!res.ok) {
    const error = await parseError(res);
    if (res.status === 401 && !opts.skipAuthRedirect && onUnauthorized) onUnauthorized();
    throw error;
  }

  if (res.status === 204) return undefined as T;
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('application/json')) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>(path, { signal }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

/** Télécharge une route GET comme fichier (sauvegarde JSON). */
export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(path, { credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'network', 'Impossible de joindre le serveur. Vérifie ta connexion.');
  }
  if (!res.ok) {
    const error = await parseError(res);
    if (res.status === 401 && onUnauthorized) onUnauthorized();
    throw error;
  }
  const disposition = res.headers.get('content-disposition') ?? '';
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  const name = match ? decodeURIComponent(match[1]) : fallbackName;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Message lisible pour n'importe quelle erreur attrapée. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return 'Une erreur inattendue est survenue.';
}
