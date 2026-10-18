import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, errorMessage, request } from '../api';
import { useAuth } from '../auth';
import { BusyButton, Field } from '../components/ui';
import { useDocumentTitle } from '../hooks';
import { Icon } from '../icons';
import type { Ok } from '../types';

const MIN_PASSWORD = 10;

export function Brand() {
  return (
    <div className="brand auth-brand">
      <span className="brand-mark" aria-hidden="true">
        <span />
      </span>
      <div>
        <div className="brand-name">Smart Dashboard</div>
        <div className="brand-sub">Console de gestion</div>
      </div>
    </div>
  );
}

export const LOGIN_HINT = '3 à 32 caractères : lettres, chiffres, point, tiret ou tiret bas.';

export function SetupScreen() {
  useDocumentTitle('Créer le compte administrateur');
  const { refresh } = useAuth();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const tooShort = password.length > 0 && password.length < MIN_PASSWORD;
  const mismatch = confirm.length > 0 && confirm !== password;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!/^[A-Za-z0-9._-]{3,32}$/.test(login.trim())) {
      setError(`Identifiant invalide : ${LOGIN_HINT.toLowerCase()}`);
      return;
    }
    if (password.length < MIN_PASSWORD) {
      setError(`Le mot de passe doit faire au moins ${MIN_PASSWORD} caractères.`);
      return;
    }
    if (password !== confirm) {
      setError('Les deux mots de passe ne correspondent pas.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await request<Ok>('/api/auth/setup', { method: 'POST', body: { login: login.trim(), password }, skipAuthRedirect: true });
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={submit} noValidate>
        <Brand />
        <div>
          <h1 className="auth-title">Compte administrateur</h1>
          <p className="auth-text">
            Première connexion : choisis l’identifiant et le mot de passe du compte qui gère ce serveur (et ton propre foyer).
          </p>
        </div>
        <Field label="Identifiant" htmlFor="setup-login" hint={LOGIN_HINT}>
          <input
            id="setup-login"
            className="input"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            placeholder="admin"
            autoFocus
            required
          />
        </Field>
        <Field
          label="Mot de passe"
          htmlFor="setup-password"
          error={tooShort ? `Encore ${MIN_PASSWORD - password.length} caractère${MIN_PASSWORD - password.length > 1 ? 's' : ''}.` : null}
        >
          <input
            id="setup-password"
            className="input"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={tooShort || undefined}
            required
            minLength={MIN_PASSWORD}
          />
        </Field>
        <Field label="Confirmer le mot de passe" htmlFor="setup-confirm" error={mismatch ? 'Les mots de passe ne correspondent pas.' : null}>
          <input
            id="setup-confirm"
            className="input"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            aria-invalid={mismatch || undefined}
            required
          />
        </Field>
        {error && (
          <div className="banner error" role="alert">
            <Icon name="alert" size={20} />
            <div>{error}</div>
          </div>
        )}
        <BusyButton type="submit" className="btn btn-primary btn-block" busy={busy} busyLabel="Création…">
          Créer et me connecter
        </BusyButton>
      </form>
    </div>
  );
}

export function LoginScreen() {
  useDocumentTitle('Connexion');
  const { refresh } = useAuth();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [needTotp, setNeedTotp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (needTotp) codeRef.current?.focus();
  }, [needTotp]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!login.trim() || !password) {
      setError('Saisis ton identifiant et ton mot de passe.');
      return;
    }
    if (needTotp && !/^\d{6}$/.test(code)) {
      setError('Le code doit comporter 6 chiffres.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await request<Ok>('/api/auth/login', {
        method: 'POST',
        body: needTotp ? { login: login.trim(), password, totp: code } : { login: login.trim(), password },
        skipAuthRedirect: true,
      });
      await refresh();
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiError && err.code === 'invalid_totp') {
        setError(err.message || 'Code de vérification incorrect.');
        setCode('');
        return;
      }
      if (err instanceof ApiError && err.code === 'totp_required') {
        if (needTotp) setError(err.message || 'Code de double authentification incorrect.');
        setNeedTotp(true);
        setCode('');
        return;
      }
      if (err instanceof ApiError && err.code === 'invalid_credentials') {
        setError(needTotp ? 'Identifiant, mot de passe ou code incorrect.' : 'Identifiant ou mot de passe incorrect.');
        if (needTotp) setCode('');
        return;
      }
      setError(errorMessage(err));
    }
  };

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={submit} noValidate>
        <Brand />
        <div>
          <h1 className="auth-title">{needTotp ? 'Double authentification' : 'Connexion'}</h1>
          <p className="auth-text">
            {needTotp
              ? 'Saisis le code à 6 chiffres affiché dans ton application d’authentification.'
              : 'Accède à la console de ton foyer et de tes écrans.'}
          </p>
        </div>
        <Field label="Identifiant" htmlFor="login-id">
          <input
            id="login-id"
            className="input"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            autoFocus
            required
            readOnly={needTotp}
          />
        </Field>
        <Field label="Mot de passe" htmlFor="login-password">
          <input
            id="login-password"
            className="input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            readOnly={needTotp}
          />
        </Field>
        {needTotp && (
          <Field label="Code à 6 chiffres" htmlFor="login-totp">
            <input
              ref={codeRef}
              id="login-totp"
              className="input mono code-input"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              required
            />
          </Field>
        )}
        {error && (
          <div className="banner error" role="alert">
            <Icon name="alert" size={20} />
            <div>{error}</div>
          </div>
        )}
        <BusyButton type="submit" className="btn btn-primary btn-block" busy={busy} busyLabel="Connexion…">
          {needTotp ? 'Valider le code' : 'Se connecter'}
        </BusyButton>
        {needTotp && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setNeedTotp(false);
              setCode('');
              setError(null);
            }}
          >
            Revenir au mot de passe
          </button>
        )}
      </form>
    </div>
  );
}
