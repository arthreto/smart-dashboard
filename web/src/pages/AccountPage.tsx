import { useEffect, useState, type FormEvent } from 'react';
import { api, errorMessage } from '../api';
import { useAuth } from '../auth';
import { useOverview } from '../components/Layout';
import { useToast } from '../components/Toast';
import { BusyButton, Field } from '../components/ui';
import { useDocumentTitle } from '../hooks';
import type { PublicUser } from '../types';
import { BackupCard } from './device/BackupCard';
import { AccountSecurityCard } from './device/SecurityCards';
import { LOGIN_HINT } from './AuthScreen';

export function AccountPage() {
  useDocumentTitle('Mon compte');
  const { status } = useAuth();
  const overview = useOverview();
  const user = status?.user;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <div className="page-kicker">
            {user ? `${user.role === 'admin' ? 'Administrateur' : 'Compte'} · foyer « ${user.household.name} »` : ''}
          </div>
          <h1 className="page-title">Mon compte</h1>
        </div>
      </header>

      <div className="grid-cards">
        {user && <ProfileCard user={user} />}
        <AccountSecurityCard />
        <BackupCard onRestored={() => void overview.reload()} />
      </div>
    </div>
  );
}

function ProfileCard({ user }: { user: PublicUser }) {
  const toast = useToast();
  const { setUser } = useAuth();
  const [login, setLogin] = useState(user.login);
  const [name, setName] = useState(user.name);
  const [householdName, setHouseholdName] = useState(user.household.name);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setLogin(user.login);
    setName(user.name);
    setHouseholdName(user.household.name);
  }, [user]);

  const dirty = login.trim() !== user.login || name.trim() !== user.name || householdName.trim() !== user.household.name;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!/^[A-Za-z0-9._-]{3,32}$/.test(login.trim())) {
      setError(`Identifiant invalide : ${LOGIN_HINT.toLowerCase()}`);
      return;
    }
    if (!householdName.trim()) {
      setError('Donne un nom à ton foyer.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next = await api.patch<PublicUser>('/api/auth/profile', {
        login: login.trim(),
        name: name.trim(),
        householdName: householdName.trim(),
      });
      setUser(next);
      toast.success('Profil enregistré.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card" aria-labelledby="profile-title">
      <h2 className="card-title" id="profile-title" style={{ marginBottom: 12 }}>
        Profil
      </h2>
      <form className="stack" onSubmit={submit} noValidate>
        <Field label="Identifiant de connexion" htmlFor="profile-login" hint={LOGIN_HINT}>
          <input
            id="profile-login"
            className="input"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={login}
            onChange={(e) => setLogin(e.target.value)}
          />
        </Field>
        <div className="form-grid">
          <Field label="Prénom" htmlFor="profile-name">
            <input id="profile-name" className="input" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Nom du foyer" htmlFor="profile-household">
            <input id="profile-household" className="input" maxLength={60} value={householdName} onChange={(e) => setHouseholdName(e.target.value)} />
          </Field>
        </div>
        {error && (
          <span className="field-error" role="alert">
            {error}
          </span>
        )}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <BusyButton type="submit" className="btn btn-primary" busy={busy} disabled={!dirty}>
            Enregistrer
          </BusyButton>
        </div>
      </form>
    </section>
  );
}
