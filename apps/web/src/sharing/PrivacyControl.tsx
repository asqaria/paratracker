import { PRIVACY_LEVELS, type Privacy } from '@skyline/core';
import { useState } from 'react';

import { useT } from '../i18n/locale';
import type { MessageKey } from '../i18n/messages';

interface PrivacyControlProps {
  privacy: Privacy;
  onPrivacy: (privacy: Privacy) => Promise<void>;
  /** Ссылка «по ссылке»: полный адрес для буфера обмена. */
  onShareLink: () => Promise<string>;
  onResetLink: () => Promise<string>;
  /** Код iframe для сайта (задача 3.9). */
  onEmbedCode: () => Promise<string>;
}

const LABELS: Record<Privacy, MessageKey> = {
  public: 'privacy.public',
  unlisted: 'privacy.unlisted',
  private: 'privacy.private',
};

type Notice = 'copied' | 'reset' | 'embed' | 'error' | null;

const NOTICES: Record<Exclude<Notice, null>, MessageKey> = {
  copied: 'share.copied',
  reset: 'share.resetDone',
  embed: 'share.embedCopied',
  error: 'share.error',
};

/**
 * Кто видит полёт и ссылка на него (задача 3.7). Только у владельца.
 * «Только я» — ссылки нет: она всё равно не откроет полёт.
 */
export function PrivacyControl({ privacy, onPrivacy, onShareLink, onResetLink, onEmbedCode }: PrivacyControlProps) {
  const t = useT();
  const [notice, setNotice] = useState<Notice>(null);

  const copy = async (link: Promise<string>, done: Notice): Promise<void> => {
    try {
      await navigator.clipboard.writeText(await link);
      setNotice(done);
    } catch {
      setNotice('error');
    }
  };

  return (
    <div data-panel="privacy" className="mb-2 text-sm">
      <div role="group" aria-label={t('privacy.label')} className="flex items-center gap-1">
        <span className="mr-1 text-xs text-secondary">{t('privacy.label')}:</span>
        {PRIVACY_LEVELS.map((level) => (
          <button
            key={level}
            type="button"
            aria-pressed={level === privacy}
            onClick={() => {
              setNotice(null);
              onPrivacy(level).catch(() => setNotice('error'));
            }}
            className="rounded px-2 py-0.5 text-xs text-secondary aria-pressed:bg-subtle aria-pressed:text-primary compact:min-h-11"
          >
            {t(LABELS[level])}
          </button>
        ))}
      </div>
      {privacy !== 'private' && (
        <div className="mt-1 flex items-center gap-3 text-xs">
          <button type="button" onClick={() => void copy(onShareLink(), 'copied')} className="text-accent compact:min-h-11">
            {t('share.copy')}
          </button>
          <button type="button" onClick={() => void copy(onEmbedCode(), 'embed')} className="text-accent compact:min-h-11">
            {t('share.embed')}
          </button>
          <button type="button" onClick={() => void copy(onResetLink(), 'reset')} className="text-secondary hover:text-primary compact:min-h-11">
            {t('share.reset')}
          </button>
        </div>
      )}
      {notice && (
        <p role="status" className={`mt-1 text-xs ${notice === 'error' ? 'text-danger' : 'text-secondary'}`}>
          {t(NOTICES[notice])}
        </p>
      )}
    </div>
  );
}
