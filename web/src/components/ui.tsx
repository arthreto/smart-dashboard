// Petits composants d'interface réutilisables.
import { useId, type ReactNode } from 'react';
import { DAY_FULL, DAY_LETTERS } from '../format';
import { Icon, type IconName } from '../icons';
import type { EventLevel, ServiceStatus, WeekDays } from '../types';

// ---------- Interrupteur ----------
interface SwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
  id?: string;
}

export function Switch({ checked, onChange, label, disabled, id }: SwitchProps) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="switch"
      disabled={disabled}
      onClick={() => onChange(!checked)}
    />
  );
}

// ---------- Spinner / squelettes ----------
export function Spinner({ large, label }: { large?: boolean; label?: string }) {
  return (
    <span className={large ? 'spinner lg' : 'spinner'} role={label ? 'status' : undefined} aria-label={label} />
  );
}

export function Skeleton({ height = 16, width = '100%', radius }: { height?: number; width?: number | string; radius?: number }) {
  return <div className="skeleton" style={{ height, width, borderRadius: radius }} aria-hidden="true" />;
}

export function CardSkeleton({ lines = 4, title = true }: { lines?: number; title?: boolean }) {
  return (
    <section className="card flex-col" aria-busy="true" aria-label="Chargement">
      {title && <Skeleton height={22} width="45%" />}
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} height={44} radius={12} />
      ))}
    </section>
  );
}

export function PageLoading({ label = 'Chargement…' }: { label?: string }) {
  return (
    <div className="center-fill" role="status">
      <Spinner large />
      <span>{label}</span>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="banner error" role="alert">
      <Icon name="alert" size={20} />
      <div className="spacer">
        <div style={{ fontWeight: 600 }}>Chargement impossible</div>
        <div>{message}</div>
      </div>
      {onRetry && (
        <button type="button" className="btn btn-sm btn-outline" onClick={onRetry}>
          Réessayer
        </button>
      )}
    </div>
  );
}

// ---------- Pastille de statut (jamais la couleur seule : toujours du texte) ----------
const STATUS_LABELS: Record<ServiceStatus, string> = {
  ok: 'OK',
  warning: 'ATTENTION',
  error: 'ERREUR',
  disabled: 'DÉSACTIVÉ',
  local: 'LOCAL',
};

export function StatusPill({ status, label, large, dot }: { status: ServiceStatus; label?: string; large?: boolean; dot?: boolean }) {
  const variant = status === 'ok' ? 'pill-ok' : status === 'warning' ? 'pill-warning' : status === 'error' ? 'pill-error' : '';
  return (
    <span className={['pill', variant, large ? 'lg' : '', dot ? 'pill-dot' : ''].filter(Boolean).join(' ')}>
      {label ?? STATUS_LABELS[status] ?? String(status).toUpperCase()}
    </span>
  );
}

const LEVEL_LABELS: Record<EventLevel, string> = {
  info: 'Info',
  success: 'Réussi',
  warning: 'Attention',
  error: 'Erreur',
};

export function LevelText({ level }: { level: EventLevel }) {
  const cls = level === 'success' ? 'text-ok' : level === 'warning' ? 'text-warning' : level === 'error' ? 'text-error' : 'text-2';
  return (
    <span className={cls} style={{ fontWeight: 600 }}>
      {LEVEL_LABELS[level] ?? level}
    </span>
  );
}

// ---------- Tuile d'icône colorée ----------
export function IconTile({
  icon,
  color,
  size = 'md',
  children,
}: {
  icon?: IconName;
  color: string;
  size?: 'sm' | 'md' | 'lg';
  children?: ReactNode;
}) {
  const px = size === 'lg' ? 22 : size === 'sm' ? 16 : 17;
  return (
    <span className={`tile ${size === 'md' ? '' : size}`} style={{ background: color }} aria-hidden="true">
      {children ?? (icon && <Icon name={icon} size={px} strokeWidth={2.2} />)}
    </span>
  );
}

// ---------- Sélecteur de jours ----------
export function DayPicker({
  value,
  onChange,
  small,
  label = 'Jours',
}: {
  value: WeekDays;
  onChange: (next: WeekDays) => void;
  small?: boolean;
  label?: string;
}) {
  const id = useId();
  return (
    <div className="field">
      <span className="field-label" id={id}>
        {label}
      </span>
      <div className={small ? 'days sm' : 'days'} role="group" aria-labelledby={id}>
        {value.map((on, i) => (
          <button
            key={i}
            type="button"
            className="day-btn"
            aria-pressed={on}
            aria-label={DAY_FULL[i]}
            onClick={() => {
              const next = value.slice() as WeekDays;
              next[i] = !on;
              onChange(next);
            }}
          >
            {DAY_LETTERS[i]}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------- Ligne de réglage ----------
export function SettingRow({
  label,
  sub,
  htmlFor,
  children,
}: {
  label: ReactNode;
  sub?: ReactNode;
  htmlFor?: string;
  children?: ReactNode;
}) {
  const content = (
    <>
      {label}
      {sub && <span className="sub">{sub}</span>}
    </>
  );
  return (
    <div className="setting-row">
      {htmlFor ? (
        <label className="setting-label" htmlFor={htmlFor}>
          {content}
        </label>
      ) : (
        <div className="setting-label">{content}</div>
      )}
      {children && <div className="setting-control">{children}</div>}
    </div>
  );
}

// ---------- Champ de formulaire ----------
export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
  className,
}: {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className ? `field ${className}` : 'field'}>
      {htmlFor ? (
        <label className="field-label" htmlFor={htmlFor}>
          {label}
        </label>
      ) : (
        <span className="field-label">{label}</span>
      )}
      {children}
      {error ? (
        <span className="field-error" role="alert">
          {error}
        </span>
      ) : (
        hint && <span className="field-hint">{hint}</span>
      )}
    </div>
  );
}

// ---------- Bouton avec état de chargement ----------
export function BusyButton({
  busy,
  children,
  className = 'btn',
  onClick,
  type = 'button',
  disabled,
  busyLabel,
  icon,
  ariaLabel,
}: {
  busy?: boolean;
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  type?: 'button' | 'submit';
  disabled?: boolean;
  busyLabel?: string;
  icon?: IconName;
  ariaLabel?: string;
}) {
  return (
    <button
      type={type}
      className={className}
      onClick={onClick}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      aria-label={ariaLabel}
    >
      {busy ? <Spinner /> : icon ? <Icon name={icon} size={17} strokeWidth={2.3} /> : null}
      {busy && busyLabel ? busyLabel : children}
    </button>
  );
}
