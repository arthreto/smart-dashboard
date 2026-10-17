import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../api';
import { deviceHeadline, useOverview } from '../components/Layout';
import { Modal, useConfirm } from '../components/Modal';
import { useToast } from '../components/Toast';
import { BusyButton, ErrorState, IconTile, LevelText, Skeleton, StatusPill } from '../components/ui';
import { formatAgo, formatEventTime, formatLongDate, formatTime, plural } from '../format';
import { useBusy, useDocumentTitle, useNow } from '../hooks';
import { Icon } from '../icons';
import { serviceMeta, sourceLabel } from '../services';
import type { DeviceCommandType, Overview } from '../types';

const SCREENSHOT_URL = '/api/device/screenshot.jpg';
const POLL_EVERY_MS = 5_000;
const POLL_ATTEMPTS = 18; // ≈ 90 s : la tablette récupère la commande à sa prochaine synchro

const COMMAND_TOASTS: Record<DeviceCommandType, string> = {
  wake: 'Réveil de l’écran demandé.',
  lock: 'Verrouillage demandé.',
  reboot: 'Redémarrage demandé.',
  message: 'Message envoyé à l’écran.',
  reload: 'Rechargement demandé.',
  screenshot: 'Capture demandée.',
};

export function OverviewPage() {
  useDocumentTitle('Vue d’ensemble');
  const overview = useOverview();
  const now = useNow(15_000);
  const toast = useToast();
  const [syncing, runSync] = useBusy();
  const [syncedAt, setSyncedAt] = useState<Date | null>(null);
  const [messageOpen, setMessageOpen] = useState(false);

  const sync = () =>
    runSync(async () => {
      try {
        await api.post('/api/sync');
        setSyncedAt(new Date());
        toast.success('Synchronisation lancée pour toutes les intégrations actives.');
        window.setTimeout(() => void overview.reload(), 2_500);
      } catch (err) {
        toast.error(errorMessage(err));
      }
    });

  // Le libellé « Synchronisé à 07:42 » s'efface après une minute.
  useEffect(() => {
    if (!syncedAt) return;
    const id = window.setTimeout(() => setSyncedAt(null), 60_000);
    return () => window.clearTimeout(id);
  }, [syncedAt]);

  const sendCommand = useCallback(
    async (type: DeviceCommandType, text?: string): Promise<boolean> => {
      try {
        await api.post<{ id: number }>('/api/device/commands', text !== undefined ? { type, text } : { type });
        const online = overview.data?.device.online;
        toast.success(
          `${COMMAND_TOASTS[type]} ${online === false ? 'La tablette l’appliquera dès qu’elle sera de nouveau en ligne.' : 'Elle sera appliquée à la prochaine synchro de la tablette.'}`,
        );
        return true;
      } catch (err) {
        toast.error(errorMessage(err));
        return false;
      }
    },
    [overview.data?.device.online, toast],
  );

  const data = overview.data;

  return (
    <div className="page" style={{ gap: 24 }}>
      <header className="page-header">
        <div>
          <div className="page-kicker">{formatLongDate(new Date(now))}</div>
          <h1 className="page-title">Vue d’ensemble</h1>
        </div>
        <div className="page-actions">
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => setMessageOpen(true)}
            disabled={data ? !data.device.paired : true}
          >
            <Icon name="message" size={17} strokeWidth={2.2} />
            Envoyer un message à l’écran
          </button>
          <BusyButton className="btn btn-primary" busy={syncing} busyLabel="Synchronisation…" icon="sync" onClick={() => void sync()}>
            {syncedAt ? `Synchronisé à ${formatTime(syncedAt)}` : 'Synchroniser maintenant'}
          </BusyButton>
        </div>
      </header>

      {overview.error && !data && <ErrorState message={overview.error} onRetry={() => void overview.reload()} />}

      <StatCards data={data} now={now} />

      <div className="grid-2 stretch">
        <ServicesCard data={data} />
        <LiveScreenCard data={data} sendCommand={sendCommand} />
      </div>

      <ActivityCard data={data} now={now} />

      {messageOpen && (
        <MessageModal
          onClose={() => setMessageOpen(false)}
          onSend={async (text) => {
            const ok = await sendCommand('message', text);
            if (ok) setMessageOpen(false);
          }}
        />
      )}
    </div>
  );
}

// ---------- Cartes de chiffres ----------
function StatCards({ data, now }: { data: Overview | null; now: number }) {
  if (!data) {
    return (
      <div className="grid-stats" aria-busy="true">
        {Array.from({ length: 4 }, (_, i) => (
          <section key={i} className="card stat-card">
            <Skeleton height={14} width="55%" />
            <div style={{ height: 12 }} />
            <Skeleton height={30} width="70%" />
            <div style={{ height: 10 }} />
            <Skeleton height={14} width="80%" />
          </section>
        ))}
      </div>
    );
  }

  const { device, today, lastSync } = data;
  const head = deviceHeadline(device);
  const state = !device.paired ? 'Non associée' : device.online ? 'En ligne' : 'Hors ligne';
  const deviceFoot: string[] = [];
  if (device.paired) {
    if (typeof device.battery === 'number') deviceFoot.push(`${device.battery} %${device.charging ? ' · en charge' : ''}`);
    if (!device.charging && typeof device.autonomyDays === 'number')
      deviceFoot.push(`environ ${plural(Math.round(device.autonomyDays), 'jour')} d’autonomie`);
    if (!device.online && device.lastSeenAt) deviceFoot.push(`vue ${formatAgo(device.lastSeenAt, now)}`);
  } else {
    deviceFoot.push('Associe ta tablette dans « Appareil »');
  }
  const pct = today.total > 0 ? Math.round((today.done / today.total) * 100) : 0;

  return (
    <div className="grid-stats">
      <section className="card stat-card" aria-label="Tablette">
        <div className="stat-label">Tablette</div>
        <div className="stat-value">
          <span className={`dot lg dot-${head.tone}`} aria-hidden="true" />
          {state}
        </div>
        <div className="stat-foot">{deviceFoot.join(' · ') || '—'}</div>
      </section>
      <section className="card stat-card" aria-label="Dernière synchronisation">
        <div className="stat-label">Dernière synchronisation</div>
        <div className="stat-value">{lastSync ? formatTime(lastSync) : '—'}</div>
        <div className="stat-foot">{lastSync ? formatAgo(lastSync, now) : 'Aucune synchronisation pour l’instant'}</div>
      </section>
      <section className="card stat-card" aria-label="Tâches aujourd’hui">
        <div className="stat-label">Tâches aujourd’hui</div>
        <div className="stat-value">
          {today.done} / {today.total}
        </div>
        <div
          className="progress"
          style={{ marginTop: 12 }}
          role="progressbar"
          aria-label="Progression des tâches du jour"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-valuetext={`${today.done} sur ${today.total}`}
        >
          <span style={{ width: `${pct}%` }} />
        </div>
      </section>
      <section className="card stat-card" aria-label="Série en cours">
        <div className="stat-label">Série en cours</div>
        <div className="stat-value">{plural(today.streak, 'jour')}</div>
        <div className="stat-foot">Record : {plural(today.bestStreak, 'jour')}</div>
      </section>
    </div>
  );
}

// ---------- État des services ----------
function ServicesCard({ data }: { data: Overview | null }) {
  return (
    <section className="card" aria-labelledby="services-title">
      <div className="card-head baseline">
        <h2 className="card-title" id="services-title">
          État des services
        </h2>
        <Link to="/integrations" className="card-link">
          Gérer les intégrations
        </Link>
      </div>
      {!data ? (
        <div className="stack" style={{ marginTop: 14, gap: 12 }}>
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} height={46} radius={12} />
          ))}
        </div>
      ) : data.services.length === 0 ? (
        <div className="empty">
          <strong>Aucun service</strong>
          Active une intégration pour la voir apparaître ici.
        </div>
      ) : (
        <ul className="service-list">
          {data.services.map((s) => {
            const meta = serviceMeta(s.id);
            return (
              <li key={s.id} className="service-row">
                <IconTile icon={meta.icon} color={s.status === 'disabled' ? '#3A3A41' : meta.color} />
                <div className="spacer" style={{ minWidth: 0 }}>
                  <div className="service-name">{s.name}</div>
                  {s.detail && <div className="service-detail">{s.detail}</div>}
                </div>
                <StatusPill status={s.status} />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ---------- Écran en direct ----------
function LiveScreenCard({
  data,
  sendCommand,
}: {
  data: Overview | null;
  sendCommand: (type: DeviceCommandType) => Promise<boolean>;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const now = useNow(5_000);
  const [stamp, setStamp] = useState(() => Date.now());
  const [missing, setMissing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [capturedAt, setCapturedAt] = useState<string | null>(null);
  const [shownAt, setShownAt] = useState<number | null>(null);
  const [polling, setPolling] = useState(false);
  const [pending, setPending] = useState<DeviceCommandType | null>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
    };
  }, []);

  /** Interroge l'en-tête de la capture (HEAD) pour savoir si une nouvelle image est arrivée. */
  const probe = useCallback(async (): Promise<string | null> => {
    try {
      const res = await fetch(SCREENSHOT_URL, { method: 'HEAD', credentials: 'same-origin', cache: 'no-store' });
      if (res.status === 404) return 'none';
      if (!res.ok) return null;
      const lm = res.headers.get('last-modified');
      if (lm) setCapturedAt(lm);
      return [res.headers.get('etag'), lm, res.headers.get('content-length')].join('|');
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    void probe();
  }, [probe]);

  const paired = data?.device.paired ?? false;

  const reloadImage = () => {
    setMissing(false);
    setStamp(Date.now());
  };

  const requestCapture = async () => {
    setPending('screenshot');
    const before = await probe();
    const ok = await sendCommand('screenshot');
    setPending(null);
    if (!ok) return;
    setPolling(true);
    for (let i = 0; i < POLL_ATTEMPTS; i++) {
      await new Promise((r) => window.setTimeout(r, POLL_EVERY_MS));
      if (cancelled.current) return;
      const sig = await probe();
      if (cancelled.current) return;
      const noHeaders = sig === '||';
      if (noHeaders) {
        // Pas d'en-têtes exploitables : on recharge simplement l'image.
        reloadImage();
        continue;
      }
      if (sig && sig !== 'none' && sig !== before) {
        reloadImage();
        setPolling(false);
        toast.success('Nouvelle capture reçue.');
        return;
      }
    }
    setPolling(false);
    if (!cancelled.current) toast.info('Pas encore de nouvelle capture. La tablette est peut-être en veille profonde.');
  };

  const run = async (type: DeviceCommandType) => {
    if (type === 'reboot') {
      const yes = await confirm({
        title: 'Redémarrer la tablette ?',
        message: 'L’écran s’éteindra quelques secondes puis se reconnectera tout seul.',
        confirmLabel: 'Redémarrer',
        danger: true,
      });
      if (!yes) return;
    }
    setPending(type);
    await sendCommand(type);
    setPending(null);
  };

  const captureLabel = capturedAt
    ? `Capture ${formatAgo(capturedAt, now)}`
    : shownAt && !missing
      ? `Affichée depuis ${formatTime(shownAt)}`
      : '';

  return (
    <section className="card flex-col" aria-labelledby="live-title">
      <div className="card-head baseline">
        <h2 className="card-title" id="live-title">
          Écran en direct
        </h2>
        <span className="card-sub" aria-live="polite">
          {polling ? 'En attente de la tablette…' : captureLabel}
        </span>
      </div>

      <div className="screen-frame">
        {!missing && (
          <img
            key={stamp}
            src={`${SCREENSHOT_URL}?t=${stamp}`}
            alt="Dernière capture de l’écran de la tablette"
            onLoad={() => {
              setLoaded(true);
              setMissing(false);
              setShownAt(Date.now());
            }}
            onError={() => {
              setMissing(true);
              setLoaded(false);
            }}
            style={{ opacity: loaded ? 1 : 0 }}
          />
        )}
        {missing && (
          <div className="screen-empty">
            <Icon name="camera" size={26} />
            <strong>Aucune capture pour l’instant</strong>
            <span>Demande une capture pour voir ce qu’affiche la tablette.</span>
          </div>
        )}
        {!missing && !loaded && (
          <div className="screen-empty">
            <span className="spinner" aria-hidden="true" />
          </div>
        )}
        {polling && (
          <div className="screen-overlay" role="status">
            <span className="spinner" aria-hidden="true" />
            Capture en cours…
          </div>
        )}
      </div>

      <button
        type="button"
        className="btn btn-outline"
        onClick={() => void requestCapture()}
        disabled={!paired || polling || pending !== null}
      >
        {pending === 'screenshot' || polling ? <span className="spinner" aria-hidden="true" /> : <Icon name="camera" size={17} />}
        Actualiser la capture
      </button>
      <div className="row-wrap">
        <BusyButton className="btn btn-grow" busy={pending === 'wake'} disabled={!paired || pending !== null} onClick={() => void run('wake')}>
          Réveiller l’écran
        </BusyButton>
        <BusyButton className="btn btn-grow" busy={pending === 'lock'} disabled={!paired || pending !== null} onClick={() => void run('lock')}>
          Verrouiller
        </BusyButton>
        <BusyButton className="btn btn-grow" busy={pending === 'reboot'} disabled={!paired || pending !== null} onClick={() => void run('reboot')}>
          Redémarrer
        </BusyButton>
      </div>
      {data && !paired && (
        <p className="small muted">
          Aucune tablette associée. <Link to="/appareil">Associer une tablette</Link>
        </p>
      )}
    </section>
  );
}

// ---------- Journal d'activité ----------
function ActivityCard({ data, now }: { data: Overview | null; now: number }) {
  return (
    <section className="card" aria-labelledby="activity-title">
      <div className="card-head baseline" style={{ marginBottom: 8 }}>
        <h2 className="card-title" id="activity-title">
          Journal d’activité
        </h2>
        <span className="card-sub">Derniers événements</span>
      </div>
      {!data ? (
        <div className="stack" style={{ gap: 10 }}>
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} height={36} radius={8} />
          ))}
        </div>
      ) : data.events.length === 0 ? (
        <div className="empty">
          <strong>Rien à signaler</strong>
          Les synchronisations et actions apparaîtront ici.
        </div>
      ) : (
        <div className="table-scroll">
          <table className="table" style={{ minWidth: 600 }}>
            <thead>
              <tr>
                <th style={{ width: 110 }}>Heure</th>
                <th>Événement</th>
                <th style={{ width: 150 }}>Source</th>
                <th style={{ width: 110 }}>Statut</th>
              </tr>
            </thead>
            <tbody>
              {data.events.map((e) => (
                <tr key={e.id}>
                  <td className="tabular">
                    <time dateTime={e.ts}>{formatEventTime(e.ts, new Date(now))}</time>
                  </td>
                  <td>{e.message}</td>
                  <td className="muted">{sourceLabel(e.source)}</td>
                  <td>
                    <LevelText level={e.level} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ---------- Modale « message à l'écran » ----------
const MESSAGE_MAX = 140;

function MessageModal({ onClose, onSend }: { onClose: () => void; onSend: (text: string) => Promise<void> }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const trimmed = text.trim();
  return (
    <Modal title="Envoyer un message à l’écran" onClose={onClose} busy={busy}>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!trimmed) return;
          setBusy(true);
          await onSend(trimmed);
          setBusy(false);
        }}
      >
        <div className="field">
          <label className="field-label" htmlFor="screen-message">
            Message
          </label>
          <textarea
            id="screen-message"
            className="input textarea"
            rows={3}
            maxLength={MESSAGE_MAX}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="À table !"
            aria-describedby="screen-message-count"
          />
          <span className="field-hint" id="screen-message-count">
            S’affiche en grand sur la tablette · {text.length}/{MESSAGE_MAX}
          </span>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={busy}>
            Annuler
          </button>
          <BusyButton type="submit" className="btn btn-primary" busy={busy} disabled={!trimmed} icon="message">
            Envoyer
          </BusyButton>
        </div>
      </form>
    </Modal>
  );
}
