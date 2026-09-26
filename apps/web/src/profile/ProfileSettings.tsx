import { DISPLAY_NAME_MAX_LENGTH, PRIVACY_LEVELS, USERNAME, type MeResponse, type Privacy } from '@skyline/core';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import { ME_KEY } from '../auth/session';
import { useT } from '../i18n/locale';
import type { MessageKey } from '../i18n/messages';
import { profileHash } from '../routing';
import { saveProfile } from './profile-api';

/**
 * Настройки профиля (задача 3.11): имя, адрес /u/{имя}, кто видит новые
 * полёты. Без «Все» по умолчанию профиль пилота пустой — поэтому здесь.
 */

const PRIVACY_LABELS: Record<Privacy, MessageKey> = {
  public: 'privacy.public',
  unlisted: 'privacy.unlisted',
  private: 'privacy.private',
};

type Notice = 'saved' | 'taken' | 'invalid' | 'error' | null;

const NOTICES: Record<Exclude<Notice, null>, MessageKey> = {
  saved: 'profile.saved',
  taken: 'profile.taken',
  invalid: 'profile.invalid',
  error: 'profile.error',
};

export function ProfileSettings({ me }: { me: MeResponse }) {
  const t = useT();
  const client = useQueryClient();
  const [displayName, setDisplayName] = useState(me.displayName ?? '');
  const [username, setUsername] = useState(me.username);
  const [privacy, setPrivacy] = useState<Privacy>(me.defaultPrivacy);
  const [notice, setNotice] = useState<Notice>(null);
  const [saving, setSaving] = useState(false);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    setSaving(true);
    setNotice(null);
    const name = displayName.trim();
    saveProfile({ displayName: name === '' ? null : name, username, defaultPrivacy: privacy })
      .then((result) => {
        if (result.kind === 'ok') {
          client.setQueryData(ME_KEY, result.me);
          setUsername(result.me.username);
        }
        setNotice(result.kind === 'ok' ? 'saved' : result.kind);
      })
      .catch(() => setNotice('error'))
      .finally(() => setSaving(false));
  };

  return (
    <form data-panel="profile-settings" onSubmit={submit} className="flex flex-col gap-3 rounded-xl glass p-4 text-sm compact:p-2">
      <label className="flex flex-col gap-1">
        <span className="text-xs text-secondary">{t('profile.displayName')}</span>
        <input
          value={displayName}
          maxLength={DISPLAY_NAME_MAX_LENGTH}
          onChange={(event) => setDisplayName(event.target.value)}
          placeholder={me.username}
          className="rounded bg-subtle px-2 py-1 text-primary compact:min-h-11"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-secondary">{t('profile.username')}</span>
        <span className="flex items-center gap-1">
          <span className="text-secondary">/u/</span>
          <input
            value={username}
            minLength={USERNAME.minLength}
            maxLength={USERNAME.maxLength}
            onChange={(event) => setUsername(event.target.value.toLowerCase())}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className="min-w-0 flex-1 rounded bg-subtle px-2 py-1 text-primary compact:min-h-11"
          />
        </span>
      </label>
      <div role="group" aria-label={t('profile.defaultPrivacy')} className="flex flex-col gap-1">
        <span className="text-xs text-secondary">{t('profile.defaultPrivacy')}</span>
        <span className="flex gap-1">
          {PRIVACY_LEVELS.map((level) => (
            <button
              key={level}
              type="button"
              aria-pressed={level === privacy}
              onClick={() => setPrivacy(level)}
              className="rounded px-2 py-1 text-secondary aria-pressed:bg-subtle aria-pressed:text-primary compact:min-h-11"
            >
              {t(PRIVACY_LABELS[level])}
            </button>
          ))}
        </span>
        <span className="text-xs text-secondary">{t('profile.defaultPrivacyHint')}</span>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded bg-accent px-3 py-1 font-semibold text-void disabled:opacity-50 compact:min-h-11"
        >
          {t('profile.save')}
        </button>
        <a href={profileHash(me.username)} className="text-accent">
          {t('profile.open')}
        </a>
      </div>
      {notice !== null && (
        <p role={notice === 'saved' ? 'status' : 'alert'} className={notice === 'saved' ? 'text-secondary' : 'text-danger'}>
          {t(NOTICES[notice])}
        </p>
      )}
    </form>
  );
}
