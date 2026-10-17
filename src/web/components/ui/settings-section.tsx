import type { ReactNode } from 'react';
import { SettingsHelp } from './settings-help';

type SettingsSectionProps = {
  title: string;
  help?: string;
  helpLabel?: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
  headingId?: string;
  children: ReactNode;
};

export function SettingsSection({
  title,
  help,
  helpLabel,
  subtitle,
  actions,
  className,
  headingId,
  children,
}: SettingsSectionProps) {
  const heading = (
    <h2 id={headingId}>
      {title}
      {help ? <SettingsHelp label={helpLabel ?? title}>{help}</SettingsHelp> : null}
    </h2>
  );

  return (
    <section className={className} aria-labelledby={headingId}>
      <div className="settings-title">
        {subtitle ? (
          <div>
            {heading}
            {subtitle}
          </div>
        ) : (
          heading
        )}
        {actions}
      </div>
      {children}
    </section>
  );
}
