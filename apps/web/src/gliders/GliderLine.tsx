import { gliderLabel, type GliderDto, type GliderSummary } from '@skyline/core';
import { useState } from 'react';

import { fill, useT } from '../i18n/locale';
import { SETTINGS_HASH } from '../routing';

interface GliderLineProps {
  glider: GliderSummary | null;
  /** Модель из файла (IGC HFGTY) — подсказка, когда крыло не выбрано. */
  gliderRaw: string | null;
  /** Крылья владельца; undefined — смотрит не владелец, выбора нет. */
  gliders: GliderDto[] | undefined;
  onSelect: (gliderId: string | null) => Promise<void>;
}

/**
 * Крыло полёта (задача 2.13б). Владелец выбирает из своих крыльев; нет ни
 * одного — ссылка «Добавить крыло» и то, что записал прибор.
 */
export function GliderLine({ glider, gliderRaw, gliders, onSelect }: GliderLineProps) {
  const t = useT();
  const [failed, setFailed] = useState(false);

  const hint = glider === null && gliderRaw !== null && (
    <span className="block text-xs text-secondary">{fill(t('glider.recorded'), { name: gliderRaw })}</span>
  );

  if (gliders === undefined) {
    if (glider === null && gliderRaw === null) return null;
    return (
      <p data-panel="flight-glider" className="text-sm">
        <span className="text-secondary">{t('glider.label')}: </span>
        <span className="text-primary">{glider?.label ?? t('glider.none')}</span>
        {hint}
      </p>
    );
  }

  if (gliders.length === 0) {
    return (
      <p data-panel="flight-glider" className="text-sm text-secondary">
        {t('glider.label')}:{' '}
        <a href={SETTINGS_HASH} className="text-accent">
          {t('glider.addLink')}
        </a>
        {hint}
      </p>
    );
  }

  return (
    <div data-panel="flight-glider" className="text-sm">
      <label className="flex items-center gap-2">
        <span className="text-secondary">{t('glider.label')}:</span>
        <select
          value={glider?.id ?? ''}
          onChange={(event) => {
            setFailed(false);
            onSelect(event.target.value === '' ? null : event.target.value).catch(() => setFailed(true));
          }}
          className="min-w-0 flex-1 rounded bg-subtle px-2 py-1 text-primary compact:min-h-11"
        >
          <option value="">{t('glider.none')}</option>
          {gliders.map((g) => (
            <option key={g.id} value={g.id}>
              {gliderLabel(g)}
            </option>
          ))}
        </select>
      </label>
      {hint}
      {failed && (
        <p role="alert" className="text-danger">
          {t('glider.error')}
        </p>
      )}
    </div>
  );
}
