import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import { Layout } from './components/Layout';
import { ConfirmProvider } from './components/Modal';
import { ToastProvider } from './components/Toast';
import { PageLoading } from './components/ui';
import { Icon } from './icons';
import { LoginScreen, SetupScreen } from './pages/AuthScreen';
import { DevicePage } from './pages/DevicePage';
import { HabitsPage } from './pages/HabitsPage';
import { IntegrationsPage } from './pages/IntegrationsPage';
import { OverviewPage } from './pages/OverviewPage';

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

function AuthGate() {
  const { status, error, refresh } = useAuth();

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

  if (status.setupRequired) return <SetupScreen />;
  if (!status.authenticated) return <LoginScreen />;

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<OverviewPage />} />
        <Route path="/habitudes" element={<HabitsPage />} />
        <Route path="/integrations" element={<IntegrationsPage />} />
        <Route path="/appareil" element={<DevicePage />} />
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
