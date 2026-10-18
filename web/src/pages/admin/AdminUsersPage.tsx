import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '../../api';
import { useAuth } from '../../auth';
import { CopyButton } from '../../components/IntegrationFields';
import { Modal, useConfirm } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { BusyButton, ErrorState, Field, Skeleton } from '../../components/ui';
import { formatAgo, formatDateTime, plural } from '../../format';
import { useApiData, useDocumentTitle, useNow, type ApiData } from '../../hooks';
import { Icon } from '../../icons';
import type { AdminInvite, AdminUser } from '../../types';

interface LinkInfo {
  title: string;
  text: string;
  url: string;
  expiresAt: string;
}

/** Comptes (un par foyer) et invitations. */
export function AdminUsersPage() {
  useDocumentTitle('Comptes & invitations');
  const users = useApiData<AdminUser[]>('/api/admin/users');
  const invites = useApiData<AdminInvite[]>('/api/admin/invites');
  const [link, setLink] = useState<LinkInfo | null>(null);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <div className="page-kicker">
            Administration{users.data ? ` · ${plural(users.data.length, 'compte')}` : ''}
          </div>
          <h1 className="page-title">Comptes &amp; invitations</h1>
        </div>
      </header>

      <div className="banner">
        <Icon name="shield" size={22} strokeWidth={2.2} />
        <div>
          Chaque compte a son propre foyer : ses écrans, tâches, agenda et services sont invisibles pour les autres. Pour ajouter
          quelqu’un, crée une invitation et envoie-lui le lien.
        </div>
      </div>

      <InvitesCard invites={invites} onCreated={(l) => setLink(l)} onUsed={() => void users.reload()} />
      <UsersCard users={users} onLink={(l) => setLink(l)} />

      {link && (
        <Modal title={link.title} onClose={() => setLink(null)}>
          <div className="stack">
            <p className="modal-text">{link.text}</p>
            <div className="value-box">
              <span className="value mono" style={{ wordBreak: 'break-all' }}>
                {link.url}
              </span>
              <CopyButton value={link.url} label="le lien" />
            </div>
            <p className="small muted">
              Valable jusqu’au {formatDateTime(link.expiresAt)}, une seule fois. Copie-le maintenant : il ne sera plus affiché.
            </p>
            <div className="modal-actions">
              <button type="button" className="btn btn-primary" onClick={() => setLink(null)}>
                Terminé
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ---------- Comptes ----------
function UsersCard({ users, onLink }: { users: ApiData<AdminUser[]>; onLink: (l: LinkInfo) => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const { status } = useAuth();
  const now = useNow(60_000);
  const [busy, setBusy] = useState<string | null>(null);
  const me = status?.user?.id;

  const act = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const toggleDisabled = (u: AdminUser) =>
    act(`dis-${u.id}`, async () => {
      if (!u.disabled) {
        const yes = await confirm({
          title: `Désactiver « ${u.login} » ?`,
          message: 'La personne est déconnectée tout de suite et ne peut plus se connecter. Ses écrans continuent d’afficher leurs données.',
          confirmLabel: 'Désactiver',
          danger: true,
        });
        if (!yes) return;
      }
      await api.patch(`/api/admin/users/${u.id}`, { disabled: !u.disabled });
      users.setData((l) => l?.map((x) => (x.id === u.id ? { ...x, disabled: !u.disabled } : x)) ?? l);
      toast.success(u.disabled ? `« ${u.login} » est réactivé.` : `« ${u.login} » est désactivé.`);
    });

  const toggleRole = (u: AdminUser) =>
    act(`role-${u.id}`, async () => {
      const next = u.role === 'admin' ? 'user' : 'admin';
      if (next === 'admin') {
        const yes = await confirm({
          title: `Rendre « ${u.login} » administrateur ?`,
          message: 'Il pourra gérer tous les comptes, les invitations et les clés API du serveur (mais pas voir les données des autres foyers).',
          confirmLabel: 'Rendre administrateur',
        });
        if (!yes) return;
      }
      await api.patch(`/api/admin/users/${u.id}`, { role: next });
      users.setData((l) => l?.map((x) => (x.id === u.id ? { ...x, role: next } : x)) ?? l);
      toast.success(next === 'admin' ? `« ${u.login} » est administrateur.` : `« ${u.login} » n’est plus administrateur.`);
    });

  const resetLink = (u: AdminUser) =>
    act(`reset-${u.id}`, async () => {
      const res = await api.post<{ url: string; expiresAt: string }>(`/api/admin/users/${u.id}/reset-link`);
      onLink({
        title: `Réinitialiser « ${u.login} »`,
        text: 'Envoie ce lien à la personne : elle pourra choisir un nouveau mot de passe. Sa double authentification sera désactivée.',
        url: res.url,
        expiresAt: res.expiresAt,
      });
    });

  const remove = (u: AdminUser) =>
    act(`del-${u.id}`, async () => {
      const yes = await confirm({
        title: `Supprimer « ${u.login} » ?`,
        message: `Le compte et tout le foyer « ${u.household.name} » seront supprimés définitivement : ${plural(u.devices, 'écran')}, tâches, historique, réveils et services connectés. Cette action est irréversible.`,
        confirmLabel: 'Supprimer définitivement',
        danger: true,
      });
      if (!yes) return;
      await api.del(`/api/admin/users/${u.id}`);
      users.setData((l) => l?.filter((x) => x.id !== u.id) ?? l);
      toast.success(`« ${u.login} » a été supprimé.`);
    });

  return (
    <section className="card" aria-labelledby="users-title">
      <div className="card-head baseline" style={{ marginBottom: 8 }}>
        <h2 className="card-title" id="users-title">
          Comptes
        </h2>
      </div>
      {users.error && !users.data ? (
        <ErrorState message={users.error} onRetry={() => void users.reload()} />
      ) : !users.data ? (
        <div className="stack" style={{ gap: 10 }}>
          <Skeleton height={52} radius={10} />
          <Skeleton height={52} radius={10} />
        </div>
      ) : (
        <ul className="user-list">
          {users.data.map((u) => (
            <li key={u.id} className={u.disabled ? 'user-row is-disabled' : 'user-row'}>
              <span className="account-avatar" aria-hidden="true">
                <Icon name="user" size={18} />
              </span>
              <div className="user-main">
                <div className="user-name">
                  {u.name ? `${u.name} · ` : ''}
                  <span className="mono">{u.login}</span>
                  {u.id === me && <span className="small muted"> (toi)</span>}
                </div>
                <div className="user-tags">
                  {u.role === 'admin' && <span className="pill pill-info">ADMIN</span>}
                  {u.disabled && <span className="pill pill-error">DÉSACTIVÉ</span>}
                  {u.totpEnabled && <span className="pill pill-ok">2FA</span>}
                  <span className="small muted">
                    Foyer « {u.household.name} » · {u.devices ? `${u.devicesOnline}/${u.devices} écran${u.devices > 1 ? 's' : ''} en ligne` : 'aucun écran'} ·{' '}
                    {u.lastLoginAt ? `connecté ${formatAgo(u.lastLoginAt, now)}` : 'jamais connecté'}
                  </span>
                </div>
              </div>
              {u.id !== me && (
                <div className="user-actions">
                  <BusyButton className="btn btn-sm" busy={busy === `reset-${u.id}`} disabled={busy !== null} onClick={() => void resetLink(u)}>
                    Lien de mot de passe
                  </BusyButton>
                  <BusyButton className="btn btn-sm" busy={busy === `role-${u.id}`} disabled={busy !== null} onClick={() => void toggleRole(u)}>
                    {u.role === 'admin' ? 'Retirer admin' : 'Rendre admin'}
                  </BusyButton>
                  <BusyButton className="btn btn-sm" busy={busy === `dis-${u.id}`} disabled={busy !== null} onClick={() => void toggleDisabled(u)}>
                    {u.disabled ? 'Réactiver' : 'Désactiver'}
                  </BusyButton>
                  <BusyButton
                    className="btn btn-sm btn-danger"
                    busy={busy === `del-${u.id}`}
                    disabled={busy !== null}
                    onClick={() => void remove(u)}
                    ariaLabel={`Supprimer ${u.login}`}
                  >
                    <Icon name="trash" size={15} />
                  </BusyButton>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------- Invitations ----------
const DAYS = [1, 3, 7, 14, 30];

const INVITE_STATUS: Record<AdminInvite['status'], { label: string; cls: string }> = {
  pending: { label: 'EN ATTENTE', cls: 'pill pill-info' },
  used: { label: 'UTILISÉE', cls: 'pill pill-ok' },
  expired: { label: 'EXPIRÉE', cls: 'pill' },
};

function InvitesCard({
  invites,
  onCreated,
  onUsed,
}: {
  invites: ApiData<AdminInvite[]>;
  onCreated: (l: LinkInfo) => void;
  onUsed: () => void;
}) {
  const toast = useToast();
  const now = useNow(60_000);
  const [note, setNote] = useState('');
  const [days, setDays] = useState(7);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState<number | null>(null);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api.post<{ id: number; url: string; expiresAt: string }>('/api/admin/invites', { note: note.trim(), days });
      setNote('');
      onCreated({
        title: 'Invitation créée',
        text: `Envoie ce lien${note.trim() ? ` à ${note.trim()}` : ''} : il permet de créer un compte avec son propre foyer.`,
        url: res.url,
        expiresAt: res.expiresAt,
      });
      await invites.reload();
      onUsed();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (inv: AdminInvite) => {
    setCancelling(inv.id);
    try {
      await api.del(`/api/admin/invites/${inv.id}`);
      invites.setData((l) => l?.filter((x) => x.id !== inv.id) ?? l);
      toast.success('Invitation annulée.');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setCancelling(null);
    }
  };

  return (
    <section className="card" aria-labelledby="invites-title">
      <h2 className="card-title" id="invites-title" style={{ marginBottom: 12 }}>
        Inviter quelqu’un
      </h2>
      <form className="invite-form" onSubmit={create}>
        <Field label="Pour qui ?" htmlFor="invite-note" hint="Note pour toi, facultative">
          <input id="invite-note" className="input" maxLength={80} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex. Maman, Lucas…" />
        </Field>
        <Field label="Valable" htmlFor="invite-days">
          <select id="invite-days" className="select" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {DAYS.map((d) => (
              <option key={d} value={d}>
                {plural(d, 'jour')}
              </option>
            ))}
          </select>
        </Field>
        <BusyButton type="submit" className="btn btn-primary" busy={busy} icon="link">
          Créer le lien
        </BusyButton>
      </form>

      {invites.data && invites.data.length > 0 && (
        <ul className="plain-list" style={{ marginTop: 16, borderTop: '1px solid var(--border)' }}>
          {invites.data.map((inv) => {
            const st = INVITE_STATUS[inv.status];
            return (
              <li key={inv.id} className="session-row">
                <div className="spacer" style={{ minWidth: 0 }}>
                  <div>{inv.note || 'Invitation'}</div>
                  <div className="small muted">
                    Créée {formatAgo(inv.createdAt, now)} ·{' '}
                    {inv.status === 'used'
                      ? `compte « ${inv.usedBy ?? '?'} » créé ${inv.usedAt ? formatAgo(inv.usedAt, now) : ''}`
                      : inv.status === 'pending'
                        ? `expire le ${formatDateTime(inv.expiresAt)}`
                        : `expirée le ${formatDateTime(inv.expiresAt)}`}
                  </div>
                </div>
                <span className={st.cls}>{st.label}</span>
                {inv.status === 'pending' && (
                  <BusyButton className="btn btn-sm btn-outline" busy={cancelling === inv.id} onClick={() => void cancel(inv)}>
                    Annuler
                  </BusyButton>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
