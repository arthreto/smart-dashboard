import { Link } from 'react-router-dom';
import { ErrorState, IconTile, Skeleton } from '../../components/ui';
import { plural } from '../../format';
import { useApiData, useDocumentTitle, useNow } from '../../hooks';
import { serviceMeta } from '../../services';
import type { AdminOverview } from '../../types';
import { ActivityCard } from '../OverviewPage';

/** Tableau de bord de l'administrateur : comptes, écrans, services et journal du serveur. */
export function AdminOverviewPage() {
  useDocumentTitle('Serveur');
  const now = useNow(15_000);
  const overview = useApiData<AdminOverview>('/api/admin/overview', { intervalMs: 30_000 });
  const d = overview.data;

  return (
    <div className="page" style={{ gap: 24 }}>
      <header className="page-header">
        <div>
          <div className="page-kicker">Administration{d ? ` · ${d.publicUrl}` : ''}</div>
          <h1 className="page-title">Serveur</h1>
        </div>
        <div className="page-actions">
          <Link to="/admin/comptes" className="btn btn-primary">
            Inviter quelqu’un
          </Link>
        </div>
      </header>

      {overview.error && !d && <ErrorState message={overview.error} onRetry={() => void overview.reload()} />}

      <div className="grid-stats">
        {!d ? (
          Array.from({ length: 4 }, (_, i) => (
            <section key={i} className="card stat-card">
              <Skeleton height={14} width="55%" />
              <div style={{ height: 12 }} />
              <Skeleton height={30} width="70%" />
              <div style={{ height: 10 }} />
              <Skeleton height={14} width="80%" />
            </section>
          ))
        ) : (
          <>
            <section className="card stat-card" aria-label="Comptes">
              <div className="stat-label">Comptes</div>
              <div className="stat-value">{d.users}</div>
              <div className="stat-foot">{d.disabledUsers ? `${plural(d.disabledUsers, 'désactivé')}` : 'Tous actifs'}</div>
            </section>
            <section className="card stat-card" aria-label="Foyers">
              <div className="stat-label">Foyers</div>
              <div className="stat-value">{d.households}</div>
              <div className="stat-foot">Données séparées les unes des autres</div>
            </section>
            <section className="card stat-card" aria-label="Écrans">
              <div className="stat-label">Écrans</div>
              <div className="stat-value">
                <span className={`dot lg dot-${d.devices === 0 ? 'off' : d.devicesOnline === d.devices ? 'ok' : 'warning'}`} aria-hidden="true" />
                {d.devicesOnline} / {d.devices}
              </div>
              <div className="stat-foot">en ligne, tous foyers confondus</div>
            </section>
            <section className="card stat-card" aria-label="Invitations">
              <div className="stat-label">Invitations</div>
              <div className="stat-value">{d.pendingInvites}</div>
              <div className="stat-foot">{d.pendingInvites ? 'en attente' : 'Aucune en attente'}</div>
            </section>
          </>
        )}
      </div>

      <section className="card" aria-labelledby="admin-services-title">
        <div className="card-head baseline">
          <h2 className="card-title" id="admin-services-title">
            Services proposés aux foyers
          </h2>
          <Link to="/admin/services" className="card-link">
            Clés API &amp; services
          </Link>
        </div>
        {!d ? (
          <div className="stack" style={{ marginTop: 14, gap: 12 }}>
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} height={46} radius={12} />
            ))}
          </div>
        ) : (
          <ul className="service-list">
            {d.services.map((s) => {
              const meta = serviceMeta(s.id);
              return (
                <li key={s.id} className="service-row">
                  <IconTile icon={meta.icon} color={s.available ? meta.color : '#3A3A41'} />
                  <div className="spacer" style={{ minWidth: 0 }}>
                    <div className="service-name">{s.name}</div>
                    <div className="service-detail">
                      {!s.available ? 'Masqué pour les foyers' : s.configured ? 'Proposé à tous les foyers' : 'Proposé, mais clés de l’application manquantes'}
                    </div>
                  </div>
                  <span className={`pill pill-dot ${!s.available ? '' : s.configured ? 'pill-ok' : 'pill-warning'}`}>
                    {!s.available ? 'MASQUÉ' : s.configured ? 'PRÊT' : 'À CONFIGURER'}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <ActivityCard
        events={d?.events ?? null}
        now={now}
        title="Journal du serveur"
        emptyText="Connexions, invitations et changements de configuration apparaîtront ici."
      />
    </div>
  );
}
