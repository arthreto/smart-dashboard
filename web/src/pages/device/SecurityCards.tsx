import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '../../api';
import { useAuth } from '../../auth';
import { CopyButton } from '../../components/IntegrationFields';
import { Modal, useConfirm } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { BusyButton, Field, Skeleton, SettingRow, Spinner, Switch } from '../../components/ui';
import { describeUserAgent, formatAgo } from '../../format';
import { useApiData, useNow } from '../../hooks';
import type { DeviceInfo, Session, TotpSetup } from '../../types';
import type { SettingsSaver } from './useSettingsSaver';

const LOCK_AFTER = [1, 2, 5, 10, 15, 30, 60];

/** Verrouillage d'un écran : code PIN (commun au foyer) et verrouillage au réveil (propre à l'écran). */
export function ScreenLockCard({
  device,
  saver,
  onPinSaved,
}: {
  device: DeviceInfo;
  saver: SettingsSaver;
  onPinSaved: () => void;
}) {
  const now = useNow(60_000);
  const [pinOpen, setPinOpen] = useState(false);
  const s = device.settings;
  const lockOptions = Array.from(new Set([...LOCK_AFTER, s.lockAfterMinutes])).sort((a, b) => a - b);

  return (
    <section className="card" aria-labelledby="lock-title">
      <h2 className="card-title" id="lock-title" style={{ marginBottom: 6 }}>
        Verrouillage
      </h2>

      <SettingRow
        label="Code PIN des écrans"
        sub={
          device.pinSet
            ? `${device.pinUpdatedAt ? `Modifié ${formatAgo(device.pinUpdatedAt, now)}` : 'Défini'} · commun à tous tes écrans`
            : 'Aucun code défini · commun à tous tes écrans'
        }
      >
        <button type="button" className="btn btn-sm" onClick={() => setPinOpen(true)}>
          {device.pinSet ? 'Modifier' : 'Définir'}
        </button>
      </SettingRow>

      <SettingRow
        label="Verrouiller au réveil de cet écran"
        sub={s.lockOnWake ? `Code demandé après ${s.lockAfterMinutes} min d’inactivité` : 'L’écran s’ouvre sans code'}
      >
        <Switch
          checked={s.lockOnWake}
          onChange={(v) => saver.update({ lockOnWake: v }, { immediate: true })}
          label="Verrouiller au réveil de cet écran"
          disabled={!device.pinSet && !s.lockOnWake}
        />
      </SettingRow>
      {!device.pinSet && !s.lockOnWake && <p className="small muted" style={{ marginTop: -4, paddingBottom: 8 }}>Définis d’abord un code PIN.</p>}
      {s.lockOnWake && (
        <SettingRow label="Verrouiller après" htmlFor="set-lock-after">
          <select
            id="set-lock-after"
            className="select auto"
            value={s.lockAfterMinutes}
            onChange={(e) => saver.update({ lockAfterMinutes: Number(e.target.value) }, { immediate: true })}
          >
            {lockOptions.map((m) => (
              <option key={m} value={m}>
                {m} min d’inactivité
              </option>
            ))}
          </select>
        </SettingRow>
      )}

      {pinOpen && (
        <PinModal
          onClose={() => setPinOpen(false)}
          onSaved={() => {
            setPinOpen(false);
            onPinSaved();
          }}
        />
      )}
    </section>
  );
}

/** Sécurité du compte : double authentification, mot de passe, sessions ouvertes. */
export function AccountSecurityCard() {
  const { status } = useAuth();
  const [passwordOpen, setPasswordOpen] = useState(false);

  return (
    <section className="card" aria-labelledby="security-title">
      <h2 className="card-title" id="security-title" style={{ marginBottom: 6 }}>
        Sécurité du compte
      </h2>

      <TotpBlock enabled={Boolean(status?.user?.totpEnabled)} />

      <SettingRow label="Mot de passe">
        <button type="button" className="btn btn-sm" onClick={() => setPasswordOpen(true)}>
          Changer
        </button>
      </SettingRow>

      <SessionsBlock />

      {passwordOpen && <PasswordModal onClose={() => setPasswordOpen(false)} />}
    </section>
  );
}

// ---------- Code PIN ----------
function PinModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!/^\d{4,6}$/.test(pin)) {
      setError('Le code doit comporter 4 à 6 chiffres.');
      return;
    }
    if (pin !== confirm) {
      setError('Les deux codes ne correspondent pas.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.put('/api/pin', { pin });
      toast.success('Code PIN mis à jour. Tes écrans l’utiliseront dès leur prochaine synchro.');
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  const digits = (v: string) => v.replace(/\D/g, '').slice(0, 6);

  return (
    <Modal title="Code PIN des écrans" onClose={onClose} busy={busy}>
      <form className="stack" onSubmit={submit} noValidate>
        <p className="modal-text">Ce code déverrouille tous les écrans de ton foyer. Choisis 4 à 6 chiffres.</p>
        <div className="form-grid">
          <Field label="Nouveau code" htmlFor="pin-new">
            <input
              id="pin-new"
              className="input mono pin-input"
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(digits(e.target.value))}
            />
          </Field>
          <Field label="Confirmer" htmlFor="pin-confirm">
            <input
              id="pin-confirm"
              className="input mono pin-input"
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              maxLength={6}
              value={confirm}
              onChange={(e) => setConfirm(digits(e.target.value))}
            />
          </Field>
        </div>
        {error && (
          <span className="field-error" role="alert">
            {error}
          </span>
        )}
        <div className="modal-actions">
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={busy}>
            Annuler
          </button>
          <BusyButton type="submit" className="btn btn-primary" busy={busy} disabled={pin.length < 4 || confirm.length < 4}>
            Enregistrer le code
          </BusyButton>
        </div>
      </form>
    </Modal>
  );
}

// ---------- Mot de passe ----------
function PasswordModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (next.length < 10) {
      setError('Le nouveau mot de passe doit faire au moins 10 caractères.');
      return;
    }
    if (next !== confirm) {
      setError('Les deux mots de passe ne correspondent pas.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/auth/password', { current, next });
      toast.success('Mot de passe modifié.');
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal title="Changer le mot de passe" onClose={onClose} busy={busy}>
      <form className="stack" onSubmit={submit} noValidate>
        <Field label="Mot de passe actuel" htmlFor="pwd-current">
          <input id="pwd-current" className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
        <Field label="Nouveau mot de passe" htmlFor="pwd-next" hint="Au moins 10 caractères.">
          <input id="pwd-next" className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
        <Field label="Confirmer le nouveau mot de passe" htmlFor="pwd-confirm">
          <input id="pwd-confirm" className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        {error && (
          <span className="field-error" role="alert">
            {error}
          </span>
        )}
        <div className="modal-actions">
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={busy}>
            Annuler
          </button>
          <BusyButton type="submit" className="btn btn-primary" busy={busy} disabled={!current || !next || !confirm}>
            Changer le mot de passe
          </BusyButton>
        </div>
      </form>
    </Modal>
  );
}

// ---------- Double authentification ----------
function TotpBlock({ enabled }: { enabled: boolean }) {
  const toast = useToast();
  const { setTotpEnabled } = useAuth();
  const [setup, setSetup] = useState<TotpSetup | null>(null);
  const [disabling, setDisabling] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      setSetup(await api.post<TotpSetup>('/api/auth/totp/setup'));
      setCode('');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const finish = async (action: 'enable' | 'disable') => {
    if (!/^\d{6}$/.test(code)) {
      setError('Le code doit comporter 6 chiffres.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/auth/totp/${action}`, { code });
      setTotpEnabled(action === 'enable');
      setSetup(null);
      setDisabling(false);
      setCode('');
      toast.success(action === 'enable' ? 'Double authentification activée.' : 'Double authentification désactivée.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    setSetup(null);
    setDisabling(false);
    setCode('');
    setError(null);
  };

  const codeInput = (
    <Field label="Code à 6 chiffres" htmlFor="totp-code" error={error}>
      <div className="row">
        <input
          id="totp-code"
          className="input mono code-input"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="000000"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void finish(setup ? 'enable' : 'disable');
            }
          }}
          autoFocus
        />
      </div>
    </Field>
  );

  return (
    <>
      <SettingRow
        label="Double authentification"
        sub={enabled ? 'Code à usage unique à chaque connexion' : 'Ajoute un code à usage unique à la connexion'}
      >
        {enabled ? (
          <>
            <span className="pill pill-ok">ACTIVE</span>
            {!disabling && (
              <button type="button" className="btn btn-sm btn-danger" onClick={() => setDisabling(true)}>
                Désactiver
              </button>
            )}
          </>
        ) : (
          !setup && (
            <BusyButton className="btn btn-sm btn-primary" busy={busy} onClick={() => void start()}>
              Activer
            </BusyButton>
          )
        )}
      </SettingRow>

      {setup && (
        <div className="inset stack" style={{ marginBottom: 10 }}>
          <p className="small text-2">
            1. Scanne ce QR code avec ton application d’authentification (Authy, Google Authenticator, 1Password…).
          </p>
          <div className="totp-setup">
            <img className="qr" src={setup.qrDataUrl} alt="QR code de configuration de la double authentification" width={168} height={168} />
            <div className="field" style={{ flex: 1, minWidth: 180 }}>
              <span className="field-label">Ou saisis cette clé à la main</span>
              <div className="value-box">
                <span className="value mono" style={{ wordBreak: 'break-all' }}>
                  {setup.secret}
                </span>
                <CopyButton value={setup.secret} label="la clé secrète" />
              </div>
            </div>
          </div>
          <p className="small text-2">2. Saisis le code affiché par l’application pour confirmer.</p>
          {codeInput}
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-sm btn-outline" onClick={cancel} disabled={busy}>
              Annuler
            </button>
            <BusyButton className="btn btn-sm btn-primary" busy={busy} disabled={code.length !== 6} onClick={() => void finish('enable')}>
              Activer la double authentification
            </BusyButton>
          </div>
        </div>
      )}

      {disabling && (
        <div className="inset stack" style={{ marginBottom: 10 }}>
          <p className="small text-2">Pour désactiver la double authentification, saisis un code de ton application.</p>
          {codeInput}
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-sm btn-outline" onClick={cancel} disabled={busy}>
              Annuler
            </button>
            <BusyButton className="btn btn-sm btn-danger" busy={busy} disabled={code.length !== 6} onClick={() => void finish('disable')}>
              Désactiver
            </BusyButton>
          </div>
        </div>
      )}
    </>
  );
}

// ---------- Sessions ----------
function SessionsBlock() {
  const toast = useToast();
  const confirm = useConfirm();
  const now = useNow(60_000);
  const sessions = useApiData<Session[]>('/api/auth/sessions');
  const [revoking, setRevoking] = useState<Session['id'] | null>(null);

  const revoke = async (s: Session) => {
    const yes = await confirm({
      title: 'Déconnecter cette session ?',
      message: `${describeUserAgent(s.userAgent)} devra se reconnecter avec le mot de passe.`,
      confirmLabel: 'Déconnecter',
      danger: true,
    });
    if (!yes) return;
    setRevoking(s.id);
    try {
      await api.del(`/api/auth/sessions/${encodeURIComponent(String(s.id))}`);
      sessions.setData((l) => (l ? l.filter((x) => x.id !== s.id) : l));
      toast.success('Session déconnectée.');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setRevoking(null);
    }
  };

  const list = (sessions.data ?? []).slice().sort((a, b) => Number(b.current) - Number(a.current));

  return (
    <div style={{ paddingTop: 12, borderTop: '1px solid var(--border)' }}>
      <div className="section-label" style={{ marginBottom: 4 }}>
        Sessions actives
      </div>
      {sessions.error && !sessions.data ? (
        <p className="small text-error">{sessions.error}</p>
      ) : !sessions.data ? (
        <div className="stack" style={{ gap: 8, paddingTop: 6 }}>
          <Skeleton height={40} radius={10} />
          <Skeleton height={40} radius={10} />
        </div>
      ) : (
        <ul className="plain-list">
          {list.map((s) => (
            <li key={s.id} className="session-row">
              <div className="spacer" style={{ minWidth: 0 }}>
                <div>
                  {describeUserAgent(s.userAgent)}
                  {s.current ? ' · ce navigateur' : ''}
                </div>
                <div className="small muted">
                  {s.current ? 'Maintenant' : `Active ${formatAgo(s.lastSeenAt, now)}`} · ouverte {formatAgo(s.createdAt, now)}
                </div>
              </div>
              {s.current ? (
                <span className="small text-ok" style={{ fontWeight: 700 }}>
                  Actuelle
                </span>
              ) : (
                <button type="button" className="btn btn-sm btn-danger" onClick={() => void revoke(s)} disabled={revoking === s.id}>
                  {revoking === s.id && <Spinner />}
                  Déconnecter
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
