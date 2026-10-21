import type { ReactNode } from 'react';
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import { Layout } from './components/Layout';
import { ConfirmProvider } from './components/Modal';
import { ToastProvider } from './components/Toast';
import { PageLoading } from './components/ui';
import { Icon } from './icons';
import { AccountPage } from './pages/AccountPage';
import { AdminOverviewPage } from './pages/admin/AdminOverviewPage';
import { AdminServicesPage } from './pages/admin/AdminServicesPage';
import { AdminUsersPage } from './pages/admin/AdminUsersPage';
import { LoginScreen, SetupScreen } from './pages/AuthScreen';
import { GalleryPage } from './pages/GalleryPage';
import { HabitsPage } from './pages/HabitsPage';
import { InvitePage } from './pages/InvitePage';
import { OverviewPage } from './pages/OverviewPage';
import { ScreenPage } from './pages/ScreenPage';
import { ScreensPage } from './pages/ScreensPage';
import { ServicesPage } from './pages/ServicesPage';

function NotFound() {
  return (
    <div className="page">
      <div className="empty" style={{ paddingTop: 80 }}>
        <strong>Page introuvable</strong>
        <Link to="/">Revenir à la vue d’ensemble</Link>
      </div>
    </div>
  );
}

function AdminOnly({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  return status?.user?.role === 'admin' ? <>{children}</> : <NotFound />;
}

function AuthGate() {
  const { status, error, refresh } = useAuth();
  const location = useLocation();

  if (!status) {
    if (error) {
      return (
        <div className="auth-page">
          <div className="auth-card">
            <div className="banner error" role="alert">
              <Icon name="alert" size={20} />
              <div>
                <div style={{ fontWeight: 600 }}>Serveur injoignable</div>
                <div>{error}</div>
              </div>
            </div>
            <button type="button" className="btn btn-primary btn-block" onClick={() => void refresh()}>
              Réessayer
            </button>
          </div>
        </div>
      );
    }
    return <PageLoading label="Connexion à la console…" />;
  }

  // Lien d'invitation ou de réinitialisation : accessible sans être connecté.
  if (location.pathname.startsWith('/invitation/')) {
    return (
      <Routes>
        <Route path="/invitation/:token" element={<InvitePage />} />
      </Routes>
    );
  }
  if (status.setupRequired) return <SetupScreen />;
  if (!status.authenticated) return <LoginScreen />;

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<OverviewPage />} />
        <Route path="/ecrans" element={<ScreensPage />} />
        <Route path="/ecrans/:id" element={<ScreenPage />} />
        <Route path="/habitudes" element={<HabitsPage />} />
        <Route path="/galerie" element={<GalleryPage />} />
        <Route path="/services" element={<ServicesPage />} />
        <Route path="/compte" element={<AccountPage />} />
        <Route
          path="/admin"
          element={
            <AdminOnly>
              <AdminOverviewPage />
            </AdminOnly>
          }
        />
        <Route
          path="/admin/comptes"
          element={
            <AdminOnly>
              <AdminUsersPage />
            </AdminOnly>
          }
        />
        <Route
          path="/admin/services"
          element={
            <AdminOnly>
              <AdminServicesPage />
            </AdminOnly>
          }
        />
        {/* Anciennes adresses (console à un seul écran). */}
        <Route path="/integrations" element={<Navigate to={{ pathname: '/services', search: location.search }} replace />} />
        <Route path="/appareil" element={<Navigate to="/ecrans" replace />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Layout>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <ConfirmProvider>
          <AuthProvider>
            <AuthGate />
          </AuthProvider>
        </ConfirmProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
