import { Link, useParams } from 'react-router-dom';
import { useOverview } from '../components/Layout';
import { CardSkeleton, ErrorState } from '../components/ui';
import { useApiData, useDocumentTitle } from '../hooks';
import { Icon } from '../icons';
import type { Alarm, DeviceInfo, Routine } from '../types';
import { AlarmsCard } from './device/AlarmsCard';
import { LayoutCard } from './device/LayoutCard';
import { ScreenCard } from './device/ScreenCard';
import { ScreenLockCard } from './device/SecurityCards';
import { ScreenManageCard } from './device/ScreenManageCard';
import { ScreenRemoteCard } from './device/ScreenRemoteCard';
import { useSettingsSaver } from './device/useSettingsSaver';

/** Un écran du foyer : télécommande, réveils, disposition et réglages (propres à cet écran). */
export function ScreenPage() {
  const { id: rawId } = useParams();
  const id = Number(rawId);
  const valid = Number.isInteger(id) && id > 0;
  const device = useApiData<DeviceInfo>(valid ? `/api/devices/${id}` : null);
  const alarms = useApiData<Alarm[]>(valid ? `/api/devices/${id}/alarms` : null);
  const routine = useApiData<Routine>(valid ? `/api/devices/${id}/routine` : null);
  const overview = useOverview();
  const saver = useSettingsSaver(valid ? id : null, device.setData, device.reload);
  const d = device.data;
  useDocumentTitle(d?.name ?? 'Écran');

  if (!valid) {
    return (
      <div className="page">
        <ErrorState message="Écran introuvable." />
      </div>
    );
  }

  const kicker = d
    ? [d.paired ? (d.online ? 'En ligne' : 'Hors ligne') : 'Non associé', d.firmware ? `firmware ${d.firmware}` : null].filter(Boolean).join(' · ')
    : 'Chargement…';

  const refresh = async () => {
    await Promise.all([device.reload(), overview.reload()]);
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <Link to="/ecrans" className="back-link">
            <Icon name="chevronLeft" size={16} strokeWidth={2.4} />
            Mes écrans
          </Link>
          <div className="page-kicker">{kicker}</div>
          <h1 className="page-title">{d?.name ?? 'Écran'}</h1>
        </div>
      </header>

      {device.error && !d && <ErrorState message={device.error} onRetry={() => void device.reload()} />}

      <div className="grid-cards">
        {d ? <ScreenRemoteCard device={d} /> : !device.error && <CardSkeleton lines={6} />}
        <AlarmsCard deviceId={id} alarms={alarms} routine={routine} />
        {d ? (
          <LayoutCard device={d} onSaved={(layout) => device.setData((x) => (x ? { ...x, layout } : x))} />
        ) : (
          !device.error && <CardSkeleton lines={4} />
        )}
        {d ? <ScreenCard device={d} saver={saver} /> : !device.error && <CardSkeleton lines={6} />}
        {d ? <ScreenLockCard device={d} saver={saver} onPinSaved={() => void device.reload()} /> : !device.error && <CardSkeleton lines={3} />}
        {d ? (
          <ScreenManageCard
            device={d}
            onChanged={async (next) => {
              if (next) device.setData((x) => (x ? { ...x, ...next } : x));
              await refresh();
            }}
          />
        ) : (
          !device.error && <CardSkeleton lines={5} />
        )}
      </div>
    </div>
  );
}
