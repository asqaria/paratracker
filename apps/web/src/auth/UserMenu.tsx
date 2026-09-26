import type { AuthProvidersResponse, MeResponse } from '@skyline/core';

import { useT } from '../i18n/locale';
import { signInUrl, useLogout, useMe, useProviders } from './session';

/** Размер аватара в шапке, px. */
const AVATAR_PX = 24;

interface UserMenuViewProps {
  /** undefined — ещё выясняем: ничего не показываем, чтобы кнопка не мигала. */
  me: MeResponse | null | undefined;
  providers: AuthProvidersResponse | undefined;
  onSignOut: () => void;
  currentHash: string;
}

/** Вход и выход (задача 2.10). Вход — только через Google, паролей нет. */
export function UserMenuView({ me, providers, onSignOut, currentHash }: UserMenuViewProps) {
  const t = useT();

  if (me) {
    return (
      <div data-panel="user-menu" aria-label={t('auth.account')} className="flex items-center gap-2 text-sm">
        {me.avatarUrl !== null && (
          <img
            src={me.avatarUrl}
            alt=""
            width={AVATAR_PX}
            height={AVATAR_PX}
            // Google отдаёт аватар без Referer надёжнее: с ним бывает 403.
            referrerPolicy="no-referrer"
            className="rounded-full"
          />
        )}
        <span className="max-w-40 truncate">{me.displayName ?? me.username}</span>
        <button type="button" onClick={onSignOut} className="rounded px-2 py-1 text-secondary hover:bg-subtle">
          {t('auth.signOut')}
        </button>
      </div>
    );
  }

  if (me === null && providers?.google) {
    return (
      <a href={signInUrl(currentHash)} className="rounded bg-subtle px-3 py-1 text-sm text-primary">
        {t('auth.signIn')}
      </a>
    );
  }

  return null;
}

export function UserMenu() {
  const me = useMe();
  const providers = useProviders();
  const signOut = useLogout();
  return (
    <UserMenuView
      me={me}
      providers={providers}
      onSignOut={() => void signOut()}
      currentHash={typeof window === 'undefined' ? '' : window.location.hash}
    />
  );
}
