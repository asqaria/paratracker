import { useState } from 'react';

import { useMe } from '../auth/session';
import { useT } from '../i18n/locale';
import { setLike } from './feed-api';

/**
 * Лайк полёта (задача 3.10а): счётчик меняется сразу, ответ сервера его
 * уточняет; ошибка — откат. Без входа — только счётчик, кнопка неактивна.
 */
export function LikeButton({
  flightId,
  likeCount,
  likedByMe,
  share = null,
}: {
  flightId: string;
  likeCount: number;
  likedByMe: boolean;
  share?: string | null;
}) {
  const t = useT();
  const me = useMe();
  const [state, setState] = useState({ liked: likedByMe, count: likeCount });
  const [busy, setBusy] = useState(false);

  const toggle = (): void => {
    const previous = state;
    const liked = !state.liked;
    setState({ liked, count: Math.max(0, state.count + (liked ? 1 : -1)) });
    setBusy(true);
    setLike(flightId, liked, share)
      .then((result) => setState({ liked: result.liked, count: result.likeCount }))
      .catch(() => setState(previous))
      .finally(() => setBusy(false));
  };

  return (
    <button
      type="button"
      data-like
      aria-pressed={state.liked}
      aria-label={me ? t(state.liked ? 'like.remove' : 'like.add') : t('like.signIn')}
      title={me ? undefined : t('like.signIn')}
      disabled={!me || busy}
      onClick={toggle}
      className="numeric inline-flex items-center gap-1 rounded px-2 py-1 text-sm text-secondary aria-pressed:text-danger enabled:hover:bg-subtle compact:min-h-11"
    >
      <span aria-hidden>{state.liked ? '♥' : '♡'}</span>
      {state.count}
    </button>
  );
}
