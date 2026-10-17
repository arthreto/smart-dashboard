import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { IntegrationCard } from '../components/IntegrationCard';
import { useToast } from '../components/Toast';
import { CardSkeleton, ErrorState } from '../components/ui';
import { useApiData, useDocumentTitle } from '../hooks';
import { Icon } from '../icons';
import type { Integration } from '../types';

export function IntegrationsPage() {
  useDocumentTitle('Intégrations & clés API');
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const { data, error, loading, reload, setData } = useApiData<Integration[]>('/api/integrations');

  // Retour du flux OAuth Spotify : /integrations?spotify=connected|error
  useEffect(() => {
    const spotify = params.get('spotify');
    if (!spotify) return;
    if (spotify === 'connected') toast.success('Compte Spotify connecté.');
    else toast.error('La connexion à Spotify a échoué. Vérifie le Client ID, le secret et l’URI de redirection.');
    const next = new URLSearchParams(params);
    next.delete('spotify');
    setParams(next, { replace: true });
    void reload();
  }, []); // une seule fois, au chargement de la page

  const enabled = data?.filter((i) => i.enabled) ?? [];
  const healthy = enabled.filter((i) => i.status === 'ok');
  const kicker = data
    ? `${data.length} service${data.length > 1 ? 's' : ''} · ${enabled.length} actif${enabled.length > 1 ? 's' : ''} · ${healthy.length} opérationnel${healthy.length > 1 ? 's' : ''}`
    : 'Chargement des services…';

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <div className="page-kicker">{kicker}</div>
          <h1 className="page-title">Intégrations &amp; clés API</h1>
        </div>
      </header>

      <div className="banner">
        <Icon name="lock" size={22} strokeWidth={2.2} />
        <div>
          Les clés et mots de passe sont chiffrés sur ton VPS et ne quittent jamais le serveur. La tablette ne reçoit que les
          données à afficher, avec son propre jeton d’accès.
        </div>
      </div>

      {error && !data && <ErrorState message={error} onRetry={() => void reload()} />}

      <div className="grid-cards">
        {loading && !data
          ? Array.from({ length: 4 }, (_, i) => <CardSkeleton key={i} lines={4} />)
          : data?.map((integration) => (
              <IntegrationCard
                key={integration.id}
                integration={integration}
                onUpdated={(next) => setData((list) => (list ? list.map((i) => (i.id === next.id ? next : i)) : list))}
              />
            ))}
      </div>
    </div>
  );
}
