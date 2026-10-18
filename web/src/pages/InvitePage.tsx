import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { errorMessage, request } from '../api';
import { useAuth } from '../auth';
import { BusyButton, Field, PageLoading } from '../components/ui';
import { formatDateTime } from '../format';
import { useApiData, useDocumentTitle } from '../hooks';
import { Icon } from '../icons';
import type { InviteInfo, Ok } from '../types';
import { Brand, LOGIN_HINT } from './AuthScreen';

const MIN_PASSWORD = 10;

/** Lien d'invitation (création d'un compte et de son foyer) ou de réinitialisation du mot de passe. */
export function InvitePage() {
  const { token = '' } = useParams();
  const info = useApiData<InviteInfo>(`/api/invites/${encodeURIComponent(token)}`);
  const reset = info.data?.kind === 'reset';
  useDocumentTitle(reset ? 'Nouveau mot de passe' : 'Invitation');

  if (info.loading && !info.data) return <PageLoading label="Vérification du lien…" />;

  if (info.error || !info.data?.valid) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <Brand />
          <div>
            <h1 className="auth-title">Lien expiré</h1>
            <p className="auth-text">
              {info.error ?? 'Ce lien a déjà été utilisé ou n’est plus valable. Demande-en un nouveau à la personne qui gère le serveur.'}
            </p>
          </div>
          <Link to="/" className="btn btn-outline btn-block">
            Aller à la connexion
          </Link>
        </div>
      </div>
    );
  }

  return <InviteForm token={token} info={info.data} />;
}

function InviteForm({ token, info }: { token: string; info: InviteInfo }) {
  const { status, refresh } = useAuth();
  const navigate = useNavigate();
  const reset = info.kind === 'reset';
  const [login, setLogin] = useState('');
  const [name, setName] = useState('');
  const [householdName, setHouseholdName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const tooShort = password.length > 0 && password.length < MIN_PASSWORD;
  const mismatch = confirm.length > 0 && confirm !== password;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!reset && !/^[A-Za-z0-9._-]{3,32}$/.test(login.trim())) {
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
      await request<Ok>(`/api/invites/${encodeURIComponent(token)}/accept`, {
        method: 'POST',
        body: reset ? { password } : { login: login.trim(), name: name.trim(), householdName: householdName.trim(), password },
        skipAuthRedirect: true,
      });
      await refresh();
      navigate(reset ? '/' : '/ecrans', { replace: true });
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
          <h1 className="auth-title">{reset ? 'Nouveau mot de passe' : 'Bienvenue !'}</h1>
          <p className="auth-text">
            {reset
              ? `Choisis un nouveau mot de passe pour le compte « ${info.login ?? ''} ». La double authentification sera désactivée et toutes les sessions fermées.`
              : 'Tu as été invité à utiliser ce serveur Smart Dashboard. Crée ton compte : il aura son propre foyer, avec ses écrans, ses tâches et ses services, séparés de ceux des autres.'}
          </p>
          {info.expiresAt && <p className="small muted" style={{ marginTop: 8 }}>Lien valable jusqu’au {formatDateTime(info.expiresAt)}.</p>}
        </div>

        {status?.authenticated && status.user && (
          <div className="banner" role="note">
            <Icon name="info" size={20} />
            <div>
              Tu es connecté en tant que « {status.user.login} ». {reset ? 'Valider' : 'Créer ce compte'} ouvrira une nouvelle session à la place.
            </div>
          </div>
        )}

        {!reset && (
          <>
            <Field label="Identifiant" htmlFor="inv-login" hint={LOGIN_HINT}>
              <input
                id="inv-login"
                className="input"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                value={login}
                onChange={(e) => setLogin(e.target.value)}
                autoFocus
                required
              />
            </Field>
            <div className="form-grid">
              <Field label="Ton prénom" htmlFor="inv-name" hint="Facultatif">
                <input id="inv-name" className="input" autoComplete="given-name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="Nom du foyer" htmlFor="inv-household" hint="Par exemple « Maison »">
                <input
                  id="inv-household"
                  className="input"
                  maxLength={60}
                  value={householdName}
                  onChange={(e) => setHouseholdName(e.target.value)}
                  placeholder="Maison"
                />
              </Field>
            </div>
          </>
        )}

        <Field
          label={reset ? 'Nouveau mot de passe' : 'Mot de passe'}
          htmlFor="inv-password"
          hint={`Au moins ${MIN_PASSWORD} caractères.`}
          error={tooShort ? `Encore ${MIN_PASSWORD - password.length} caractère${MIN_PASSWORD - password.length > 1 ? 's' : ''}.` : null}
        >
          <input
            id="inv-password"
            className="input"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus={reset}
            required
          />
        </Field>
        <Field label="Confirmer le mot de passe" htmlFor="inv-confirm" error={mismatch ? 'Les mots de passe ne correspondent pas.' : null}>
          <input
            id="inv-confirm"
            className="input"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
        </Field>
        {error && (
          <div className="banner error" role="alert">
            <Icon name="alert" size={20} />
            <div>{error}</div>
          </div>
        )}
        <BusyButton type="submit" className="btn btn-primary btn-block" busy={busy} busyLabel={reset ? 'Enregistrement…' : 'Création…'}>
          {reset ? 'Enregistrer et me connecter' : 'Créer mon compte'}
        </BusyButton>
      </form>
    </div>
  );
}
