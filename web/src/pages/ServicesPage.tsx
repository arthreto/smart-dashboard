import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { IntegrationCard } from '../components/IntegrationCard';
import { useToast } from '../components/Toast';
import { CardSkeleton, ErrorState } from '../components/ui';
import { useApiData, useDocumentTitle } from '../hooks';
import { Icon } from '../icons';
import type { Integration } from '../types';

export function ServicesPage() {
  useDocumentTitle('Services');
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const { data, error, loading, reload, setData } = useApiData<Integration[]>('/api/integrations');

  // Retour du flux OAuth Spotify : /services?spotify=connected|error|missing
  useEffect(() => {
    const spotify = params.get('spotify');
    if (!spotify) return;
    if (spotify === 'connected') toast.success('Compte Spotify connecté.');
    else if (spotify === 'missing') toast.error('L’application Spotify du serveur n’est pas encore configurée : demande à l’administrateur.');
    else
      toast.error(
        'La connexion à Spotify a échoué. Si le serveur est en « Development Mode », l’administrateur doit d’abord ajouter ton e-mail Spotify dans l’app.',
      );
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
  const empty = data !== null && data.length === 0;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <div className="page-kicker">{kicker}</div>
          <h1 className="page-title">Services</h1>
        </div>
      </header>

      <div className="banner">
        <Icon name="lock" size={22} strokeWidth={2.2} />
        <div>
          Connecte ici les comptes de ton foyer (Spotify, iCloud…). Ils sont partagés par tous tes écrans et invisibles pour les
          autres foyers. Les mots de passe sont chiffrés sur le serveur : les écrans ne reçoivent que les données à afficher.
        </div>
      </div>

      {error && !data && <ErrorState message={error} onRetry={() => void reload()} />}

      {empty && (
        <div className="empty card">
          <strong>Aucun service disponible</strong>
          L’administrateur du serveur n’a encore proposé aucun service.
        </div>
      )}

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
