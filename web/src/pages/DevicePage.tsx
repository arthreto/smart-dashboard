import { useOverview } from '../components/Layout';
import { CardSkeleton, ErrorState } from '../components/ui';
import { useApiData, useDocumentTitle } from '../hooks';
import type { Alarm, DeviceInfo, Routine } from '../types';
import { AlarmsCard } from './device/AlarmsCard';
import { BackupCard } from './device/BackupCard';
import { LayoutCard } from './device/LayoutCard';
import { PairingCard } from './device/PairingCard';
import { ScreenCard } from './device/ScreenCard';
import { SecurityCard } from './device/SecurityCard';
import { useSettingsSaver } from './device/useSettingsSaver';

export function DevicePage() {
  useDocumentTitle('Appareil & réveils');
  const device = useApiData<DeviceInfo>('/api/device');
  const alarms = useApiData<Alarm[]>('/api/alarms');
  const routine = useApiData<Routine>('/api/routine');
  const overview = useOverview();
  const saver = useSettingsSaver(device.setData, device.reload);

  const d = device.data;
  const kicker = d
    ? d.paired
      ? `${d.name || 'M5Stack Tab5'}${d.firmware ? ` · firmware ${d.firmware}` : ''}`
      : 'Aucune tablette associée'
    : 'Chargement…';

  const reloadAll = async () => {
    await Promise.all([device.reload(), overview.reload()]);
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <div className="page-kicker">{kicker}</div>
          <h1 className="page-title">Appareil &amp; réveils</h1>
        </div>
      </header>

      {device.error && !d && <ErrorState message={device.error} onRetry={() => void device.reload()} />}

      <div className="grid-cards">
        <AlarmsCard alarms={alarms} routine={routine} />
        {d ? (
          <LayoutCard device={d} onSaved={(layout) => device.setData((x) => (x ? { ...x, layout } : x))} />
        ) : (
          !device.error && <CardSkeleton lines={4} />
        )}
        {d ? <ScreenCard device={d} saver={saver} /> : !device.error && <CardSkeleton lines={6} />}
        {d ? (
          <SecurityCard device={d} saver={saver} onPinSaved={() => void device.reload()} />
        ) : (
          !device.error && <CardSkeleton lines={5} />
        )}
        {d ? <PairingCard device={d} reload={reloadAll} /> : !device.error && <CardSkeleton lines={3} />}
        <BackupCard
          onRestored={() => {
            void device.reload();
            void alarms.reload();
            void routine.reload();
            void overview.reload();
          }}
        />
      </div>
    </div>
  );
}
