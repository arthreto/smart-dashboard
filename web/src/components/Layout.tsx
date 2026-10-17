import { createContext, useContext, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../auth';
import { formatAgo } from '../format';
import { useApiData, useNow, type ApiData } from '../hooks';
import { Icon, type IconName } from '../icons';
import type { Overview, OverviewDevice } from '../types';

// Les données de /api/overview servent à la fois à la pastille de la barre latérale
// (rafraîchie toutes les 30 s) et à la page Vue d'ensemble : une seule source partagée.
const OverviewContext = createContext<ApiData<Overview> | null>(null);

export function useOverview(): ApiData<Overview> {
  const ctx = useContext(OverviewContext);
  if (!ctx) throw new Error('useOverview doit être utilisé dans <Layout>');
  return ctx;
}

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  color: string;
  strokeWidth: number;
}

const NAV: NavItem[] = [
  { to: '/', label: 'Vue d’ensemble', icon: 'home', color: '#0A84FF', strokeWidth: 2.2 },
  { to: '/habitudes', label: 'Tâches & habitudes', icon: 'checkCircle', color: '#30D158', strokeWidth: 2.4 },
  { to: '/integrations', label: 'Intégrations & clés API', icon: 'key', color: '#FF9F0A', strokeWidth: 2.4 },
  { to: '/appareil', label: 'Appareil & réveils', icon: 'display', color: '#636369', strokeWidth: 2.2 },
];

export function deviceHeadline(device: OverviewDevice | undefined): { title: string; tone: 'ok' | 'off' | 'warning' } {
  if (!device) return { title: 'Tablette', tone: 'off' };
  if (!device.paired) return { title: 'Aucune tablette associée', tone: 'warning' };
  return device.online ? { title: 'Tablette en ligne', tone: 'ok' } : { title: 'Tablette hors ligne', tone: 'off' };
}

function DeviceStatusPill({ overview, now }: { overview: ApiData<Overview>; now: number }) {
  const device = overview.data?.device;
  if (!device) {
    return (
      <div className="device-pill" aria-live="polite">
        <span className="dot dot-off" aria-hidden="true" />
        <div className="spacer" style={{ minWidth: 0 }}>
          <div className="device-pill-title">{overview.error ? 'État indisponible' : 'Chargement…'}</div>
          <div className="device-pill-sub">{overview.error ? 'Nouvel essai dans 30 s' : 'Connexion à la tablette'}</div>
        </div>
      </div>
    );
  }
  const head = deviceHeadline(device);
  const parts: string[] = [];
  if (device.paired) {
    parts.push(device.lastSeenAt ? `Vue ${formatAgo(device.lastSeenAt, now)}` : 'Jamais vue');
    if (typeof device.battery === 'number') parts.push(`batterie ${device.battery} %${device.charging ? ' (en charge)' : ''}`);
  } else {
    parts.push('Associe-la depuis « Appareil »');
  }
  return (
    <div className="device-pill" aria-live="polite">
      <span className={`dot dot-${head.tone}`} aria-hidden="true" />
      <div className="spacer" style={{ minWidth: 0 }}>
        <div className="device-pill-title">{head.title}</div>
        <div className="device-pill-sub">{parts.join(' · ')}</div>
      </div>
    </div>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const overview = useApiData<Overview>('/api/overview', { intervalMs: 30_000 });
  const { status, logout } = useAuth();
  const now = useNow(10_000);

  return (
    <OverviewContext.Provider value={overview}>
      <div className="app-shell">
        <aside className="sidebar">
          <div className="sidebar-inner">
            <div className="brand">
              <span className="brand-mark" aria-hidden="true">
                <span />
              </span>
              <div>
                <div className="brand-name">Smart Dashboard</div>
                <div className="brand-sub">Console de gestion</div>
              </div>
            </div>

            <DeviceStatusPill overview={overview} now={now} />

            <nav className="nav" aria-label="Console">
              {NAV.map((item) => (
                <NavLink key={item.to} to={item.to} end={item.to === '/'} className="nav-link">
                  <span className="nav-icon" style={{ background: item.color }} aria-hidden="true">
                    <Icon name={item.icon} size={16} strokeWidth={item.strokeWidth} />
                  </span>
                  {item.label}
                </NavLink>
              ))}
            </nav>

            <div className="sidebar-spacer" />

            <div className="account">
              <div className="account-row">
                <span className="account-avatar" aria-hidden="true">
                  <Icon name="user" size={18} />
                </span>
                <div className="spacer">
                  <div className="account-name">Mon compte</div>
                  <div className="account-sub">
                    {status?.totpEnabled ? 'Double authentification active' : 'Double authentification inactive'}
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="btn btn-sm btn-outline account-logout"
                aria-label="Se déconnecter"
                onClick={() => void logout()}
              >
                <Icon name="logout" size={16} />
                <span className="account-logout-label">Se déconnecter</span>
              </button>
            </div>
          </div>
        </aside>

        <main className="main" id="contenu">
          {children}
        </main>
      </div>
    </OverviewContext.Provider>
  );
}
