import { createContext, useContext, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../auth';
import { formatAgo } from '../format';
import { useApiData, useNow, type ApiData } from '../hooks';
import { Icon, type IconName } from '../icons';
import type { Overview } from '../types';

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
  end?: boolean;
}

const NAV: NavItem[] = [
  { to: '/', label: 'Vue d’ensemble', icon: 'home', color: '#0A84FF', strokeWidth: 2.2, end: true },
  { to: '/ecrans', label: 'Mes écrans', icon: 'display', color: '#5E5CE6', strokeWidth: 2.2 },
  { to: '/habitudes', label: 'Tâches & habitudes', icon: 'checkCircle', color: '#30D158', strokeWidth: 2.4 },
  { to: '/galerie', label: 'Galerie', icon: 'camera', color: '#FF375F', strokeWidth: 2.2 },
  { to: '/services', label: 'Services', icon: 'puzzle', color: '#FF9F0A', strokeWidth: 2.2 },
  { to: '/compte', label: 'Mon compte', icon: 'user', color: '#636369', strokeWidth: 2.2 },
];

const ADMIN_NAV: NavItem[] = [
  { to: '/admin', label: 'Serveur', icon: 'server', color: '#FF453A', strokeWidth: 2.2, end: true },
  { to: '/admin/comptes', label: 'Comptes & invitations', icon: 'shield', color: '#FF375F', strokeWidth: 2.2 },
  { to: '/admin/services', label: 'Clés API & services', icon: 'key', color: '#BF5AF2', strokeWidth: 2.4 },
];

function NavList({ items, label }: { items: NavItem[]; label: string }) {
  return (
    <nav className="nav" aria-label={label}>
      {items.map((item) => (
        <NavLink key={item.to} to={item.to} end={item.end} className="nav-link">
          <span className="nav-icon" style={{ background: item.color }} aria-hidden="true">
            <Icon name={item.icon} size={16} strokeWidth={item.strokeWidth} />
          </span>
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}

function ScreensPill({ overview, now }: { overview: ApiData<Overview>; now: number }) {
  const devices = overview.data?.devices;
  if (!devices) {
    return (
      <div className="device-pill" aria-live="polite">
        <span className="dot dot-off" aria-hidden="true" />
        <div className="spacer" style={{ minWidth: 0 }}>
          <div className="device-pill-title">{overview.error ? 'État indisponible' : 'Chargement…'}</div>
          <div className="device-pill-sub">{overview.error ? 'Nouvel essai dans 30 s' : 'Connexion aux écrans'}</div>
        </div>
      </div>
    );
  }
  const paired = devices.filter((d) => d.paired);
  const online = paired.filter((d) => d.online);
  let tone: 'ok' | 'off' | 'warning' = 'off';
  let title: string;
  let sub: string;
  if (paired.length === 0) {
    tone = 'warning';
    title = 'Aucun écran associé';
    sub = 'Ajoute-le depuis « Mes écrans »';
  } else if (paired.length === 1) {
    const d = paired[0];
    tone = d.online ? 'ok' : 'off';
    title = `${d.name} ${d.online ? 'en ligne' : 'hors ligne'}`;
    const parts = [d.lastSeenAt ? `Vu ${formatAgo(d.lastSeenAt, now)}` : 'Jamais vu'];
    if (typeof d.battery === 'number') parts.push(`batterie ${d.battery} %${d.charging ? ' (en charge)' : ''}`);
    sub = parts.join(' · ');
  } else {
    tone = online.length === paired.length ? 'ok' : online.length > 0 ? 'warning' : 'off';
    title = `${online.length} / ${paired.length} écrans en ligne`;
    sub = online.length === paired.length ? 'Tout fonctionne' : `Hors ligne : ${paired.filter((d) => !d.online).map((d) => d.name).join(', ')}`;
  }
  return (
    <NavLink to="/ecrans" className="device-pill" aria-live="polite">
      <span className={`dot dot-${tone}`} aria-hidden="true" />
      <div className="spacer" style={{ minWidth: 0 }}>
        <div className="device-pill-title">{title}</div>
        <div className="device-pill-sub">{sub}</div>
      </div>
    </NavLink>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const overview = useApiData<Overview>('/api/overview', { intervalMs: 30_000 });
  const { status, logout } = useAuth();
  const user = status?.user ?? null;
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

            <ScreensPill overview={overview} now={now} />

            <div className="nav-wrap">
              <NavList items={NAV} label="Mon foyer" />
              {user?.role === 'admin' && (
                <>
                  <div className="nav-section" aria-hidden="true">
                    Administration
                  </div>
                  <NavList items={ADMIN_NAV} label="Administration" />
                </>
              )}
            </div>

            <div className="sidebar-spacer" />

            <div className="account">
              <NavLink to="/compte" className="account-row">
                <span className="account-avatar" aria-hidden="true">
                  <Icon name="user" size={18} />
                </span>
                <div className="spacer" style={{ minWidth: 0 }}>
                  <div className="account-name">{user?.name || user?.login || 'Mon compte'}</div>
                  <div className="account-sub">{user ? `Foyer « ${user.household.name} »` : ''}</div>
                </div>
              </NavLink>
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
