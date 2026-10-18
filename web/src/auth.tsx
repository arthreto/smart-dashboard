import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, errorMessage, request, setUnauthorizedHandler } from './api';
import type { AuthStatus, Ok, PublicUser } from './types';

interface AuthContextValue {
  status: AuthStatus | null;
  error: string | null;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  setTotpEnabled: (enabled: boolean) => void;
  setUser: (user: PublicUser) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await request<AuthStatus>('/api/auth/status', { skipAuthRedirect: true });
      setStatus(s);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Toute réponse 401 d'une route protégée renvoie à l'écran de connexion.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setStatus((s) => (s ? { ...s, authenticated: false } : s));
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post<Ok>('/api/auth/logout');
    } catch {
      /* même en cas d'erreur réseau, on quitte la session côté interface */
    }
    setStatus((s) => (s ? { ...s, authenticated: false, user: null } : s));
  }, []);

  const setTotpEnabled = useCallback((enabled: boolean) => {
    setStatus((s) => (s && s.user ? { ...s, user: { ...s.user, totpEnabled: enabled } } : s));
  }, []);

  const setUser = useCallback((user: PublicUser) => {
    setStatus((s) => (s ? { ...s, user } : s));
  }, []);

  const value = useMemo(
    () => ({ status, error, refresh, logout, setTotpEnabled, setUser }),
    [status, error, refresh, logout, setTotpEnabled, setUser],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth doit être utilisé dans <AuthProvider>');
  return ctx;
}
