import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../api';
import { useOverview } from '../components/Layout';
import { MessageModal } from '../components/MessageModal';
import { useToast } from '../components/Toast';
import { BusyButton, ErrorState, IconTile, LevelText, Skeleton, StatusPill } from '../components/ui';
import { formatAgo, formatEventTime, formatLongDate, formatTime, plural } from '../format';
import { useBusy, useDocumentTitle, useNow } from '../hooks';
import { Icon } from '../icons';
import { serviceMeta, sourceLabel } from '../services';
import type { ActivityEvent, Overview } from '../types';
import { ScreenRow } from './ScreensPage';

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
        toast.success('Synchronisation lancée pour tous les services actifs.');
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

  const data = overview.data;
  const pairedCount = data?.devices.filter((d) => d.paired).length ?? 0;

  const broadcast = async (text: string) => {
    try {
      const res = await api.post<{ screens: number }>('/api/devices/broadcast', { text });
      toast.success(res.screens > 1 ? `Message envoyé à tes ${res.screens} écrans.` : 'Message envoyé à ton écran.');
      setMessageOpen(false);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div className="page" style={{ gap: 24 }}>
      <header className="page-header">
        <div>
          <div className="page-kicker">{formatLongDate(new Date(now))}</div>
          <h1 className="page-title">Vue d’ensemble</h1>
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn-outline" onClick={() => setMessageOpen(true)} disabled={pairedCount === 0}>
            <Icon name="message" size={17} strokeWidth={2.2} />
            {pairedCount > 1 ? 'Message à tous les écrans' : 'Message à l’écran'}
          </button>
          <BusyButton className="btn btn-primary" busy={syncing} busyLabel="Synchronisation…" icon="sync" onClick={() => void sync()}>
            {syncedAt ? `Synchronisé à ${formatTime(syncedAt)}` : 'Synchroniser maintenant'}
          </BusyButton>
        </div>
      </header>

      {overview.error && !data && <ErrorState message={overview.error} onRetry={() => void overview.reload()} />}

      <StatCards data={data} now={now} />

      <div className="grid-2 stretch">
        <ScreensCard data={data} now={now} />
        <ServicesCard data={data} />
      </div>

      <ActivityCard events={data?.events ?? null} now={now} />

      {messageOpen && (
        <MessageModal
          title={pairedCount > 1 ? 'Message à tous les écrans' : 'Message à l’écran'}
          hint={pairedCount > 1 ? 'S’affiche en grand sur chaque écran associé' : 'S’affiche en grand sur la tablette'}
          onClose={() => setMessageOpen(false)}
          onSend={broadcast}
        />
      )}
    </div>
  );
}

// ---------- Écrans du foyer ----------
function ScreensCard({ data, now }: { data: Overview | null; now: number }) {
  return (
    <section className="card" aria-labelledby="screens-title">
      <div className="card-head baseline">
        <h2 className="card-title" id="screens-title">
          Mes écrans
        </h2>
        <Link to="/ecrans" className="card-link">
          {data && data.devices.length > 0 ? 'Gérer les écrans' : 'Ajouter un écran'}
        </Link>
      </div>
      {!data ? (
        <div className="stack" style={{ marginTop: 14, gap: 12 }}>
          {Array.from({ length: 2 }, (_, i) => (
            <Skeleton key={i} height={56} radius={12} />
          ))}
        </div>
      ) : data.devices.length === 0 ? (
        <div className="empty">
          <strong>Aucun écran associé</strong>
          <span>
            Associe ta tablette depuis <Link to="/ecrans">Mes écrans</Link> : un code à 6 chiffres suffit.
          </span>
        </div>
      ) : (
        <ul className="screen-list" style={{ marginTop: 10 }}>
          {data.devices.map((d) => (
            <ScreenRow key={d.id} device={d} now={now} />
          ))}
        </ul>
      )}
    </section>
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

  const { devices, today } = data;
  const paired = devices.filter((d) => d.paired);
  const online = paired.filter((d) => d.online).length;
  const tone = paired.length === 0 ? 'warning' : online === paired.length ? 'ok' : online > 0 ? 'warning' : 'off';
  const screensFoot =
    devices.length === 0
      ? 'Ajoute ta tablette dans « Mes écrans »'
      : paired.length === 0
        ? 'Aucun écran associé'
        : online === paired.length
          ? paired.length > 1
            ? 'En ligne · tous tes écrans répondent'
            : 'En ligne · ton écran répond'
          : `En ligne · ${plural(paired.length - online, 'écran')} hors ligne`;
  const lastSync = devices
    .map((d) => d.lastSyncAt)
    .filter((x): x is string => !!x)
    .sort()
    .pop();
  const pct = today.total > 0 ? Math.round((today.done / today.total) * 100) : 0;

  return (
    <div className="grid-stats">
      <section className="card stat-card" aria-label="Écrans">
        <div className="stat-label">Écrans</div>
        <div className="stat-value">
          <span className={`dot lg dot-${tone}`} aria-hidden="true" />
          {paired.length === 0 ? 'Aucun' : `${online} / ${paired.length}`}
        </div>
        <div className="stat-foot">{screensFoot}</div>
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
        <Link to="/services" className="card-link">
          Gérer les services
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
          Active un service pour le voir apparaître ici.
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

// ---------- Journal d'activité ----------
export function ActivityCard({
  events,
  now,
  title = 'Journal d’activité',
  emptyText = 'Les synchronisations et actions apparaîtront ici.',
}: {
  events: ActivityEvent[] | null;
  now: number;
  title?: string;
  emptyText?: string;
}) {
  return (
    <section className="card" aria-labelledby="activity-title">
      <div className="card-head baseline" style={{ marginBottom: 8 }}>
        <h2 className="card-title" id="activity-title">
          {title}
        </h2>
        <span className="card-sub">Derniers événements</span>
      </div>
      {!events ? (
        <div className="stack" style={{ gap: 10 }}>
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} height={36} radius={8} />
          ))}
        </div>
      ) : events.length === 0 ? (
        <div className="empty">
          <strong>Rien à signaler</strong>
          {emptyText}
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
              {events.map((e) => (
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
