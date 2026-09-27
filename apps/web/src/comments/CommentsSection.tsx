import { COMMENT, type CommentDto } from '@skyline/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import { signInUrl, useMe } from '../auth/session';
import { fill, useLocaleStore, useT } from '../i18n/locale';
import { profileHash } from '../routing';
import {
  commentsKey,
  deleteComment,
  fetchComments,
  postComment,
  timecodeAt,
  timecodeLabel,
  timeOfTimecode,
} from './comments-api';

/**
 * Комментарии к полёту (задача 3.10б): разбор с привязкой к моменту —
 * «здесь ушёл из термика · 1:23:40», клик по времени перематывает трек.
 * Ответы — в один уровень (решение владельца 27.09.2026).
 */

export interface CommentsSectionProps {
  flightId: string;
  share: string | null;
  /** Начало записи (started_at), UNIX мс: от него хранится момент комментария. */
  startedAtMs: number;
  /**
   * Начало трека на экране, UNIX мс: от него — подпись момента, как на часах
   * таймлайна. У постороннего трек начинается позже записи (без земли, 3.7),
   * и подпись от started_at расходилась бы с таймлайном на эти секунды.
   */
  timelineStartMs: number;
  /** Текущее время проигрывания — момент нового комментария. */
  timeMs: number;
  onSeekTo: (timeMs: number) => void;
}

export function CommentsSection({ flightId, share, startedAtMs, timelineStartMs, timeMs, onSeekTo }: CommentsSectionProps) {
  const t = useT();
  const me = useMe();
  const comments = useQuery({ queryKey: commentsKey(flightId), queryFn: () => fetchComments(flightId, share) });
  const list = comments.data ?? [];
  const roots = list.filter((comment) => comment.parentId === null);
  const repliesOf = (id: string) => list.filter((comment) => comment.parentId === id);
  const live = list.filter((comment) => comment.body !== null).length;

  return (
    <section data-panel="comments" aria-label={t('comments.title')} className="mt-3 border-t border-subtle pt-3 text-sm">
      <h3 className="mb-2 font-semibold">{fill(t('comments.titleCount'), { n: String(live) })}</h3>
      {comments.isError && (
        <p role="alert" className="text-xs text-danger">
          {t('comments.error')}
        </p>
      )}
      <ul className="flex flex-col gap-3">
        {roots.map((root) => (
          <li key={root.id}>
            <CommentView comment={root} {...{ flightId, share, startedAtMs, timelineStartMs, onSeekTo }} canReply={Boolean(me) && root.body !== null} />
            {repliesOf(root.id).length > 0 && (
              <ul className="mt-2 flex flex-col gap-2 border-l border-subtle pl-3">
                {repliesOf(root.id).map((reply) => (
                  <li key={reply.id}>
                    <CommentView comment={reply} {...{ flightId, share, startedAtMs, timelineStartMs, onSeekTo }} canReply={false} />
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      {me ? (
        <CommentForm flightId={flightId} share={share} startedAtMs={startedAtMs} timelineStartMs={timelineStartMs} timeMs={timeMs} />
      ) : (
        me === null && (
          <a href={signInUrl(typeof window === 'undefined' ? '' : window.location.hash)} className="mt-3 block text-xs text-accent">
            {t('comments.signIn')}
          </a>
        )
      )}
    </section>
  );
}

function CommentView({
  comment,
  flightId,
  share,
  startedAtMs,
  timelineStartMs,
  onSeekTo,
  canReply,
}: {
  comment: CommentDto;
  flightId: string;
  share: string | null;
  startedAtMs: number;
  timelineStartMs: number;
  onSeekTo: (timeMs: number) => void;
  canReply: boolean;
}) {
  const t = useT();
  const locale = useLocaleStore((state) => state.locale);
  const client = useQueryClient();
  const [replying, setReplying] = useState(false);

  if (comment.body === null) {
    return <p className="text-xs italic text-secondary">{t('comments.deleted')}</p>;
  }
  const remove = (): void => {
    void deleteComment(flightId, share, comment.id).then(() => client.invalidateQueries({ queryKey: commentsKey(flightId) }));
  };
  return (
    <div data-comment>
      <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-secondary">
        <a href={profileHash(comment.author.username)} className="font-semibold text-primary hover:text-accent">
          {comment.author.displayName ?? comment.author.username}
        </a>
        <span>{new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(comment.createdAt))}</span>
        {comment.timecodeS !== null && (
          <button
            type="button"
            data-timecode
            onClick={() => onSeekTo(timeOfTimecode(comment.timecodeS ?? 0, startedAtMs))}
            className="numeric rounded bg-subtle px-1.5 text-accent hover:text-primary"
          >
            ▶ {timecodeLabel(timecodeAt(timeOfTimecode(comment.timecodeS, startedAtMs), timelineStartMs))}
          </button>
        )}
      </p>
      <p className="whitespace-pre-line break-words text-primary">{comment.body}</p>
      <p className="flex gap-3 text-xs">
        {canReply && (
          <button type="button" onClick={() => setReplying((value) => !value)} className="text-secondary hover:text-primary compact:min-h-11">
            {t('comments.reply')}
          </button>
        )}
        {comment.canDelete && (
          <button type="button" onClick={remove} className="text-secondary hover:text-danger compact:min-h-11">
            {t('comments.delete')}
          </button>
        )}
      </p>
      {replying && (
        <CommentForm flightId={flightId} share={share} parentId={comment.id} onDone={() => setReplying(false)} />
      )}
    </div>
  );
}

/** Новый комментарий или ответ; у комментария верхнего уровня — момент полёта по умолчанию. */
function CommentForm({
  flightId,
  share,
  startedAtMs,
  timelineStartMs,
  timeMs,
  parentId,
  onDone,
}: {
  flightId: string;
  share: string | null;
  startedAtMs?: number;
  timelineStartMs?: number;
  timeMs?: number;
  parentId?: string;
  onDone?: () => void;
}) {
  const t = useT();
  const client = useQueryClient();
  const [body, setBody] = useState('');
  const [attach, setAttach] = useState(true);
  const [error, setError] = useState(false);
  const [sending, setSending] = useState(false);
  const timecode = startedAtMs !== undefined && timeMs !== undefined ? timecodeAt(timeMs, startedAtMs) : null;

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (body.trim() === '') return;
    setSending(true);
    setError(false);
    postComment(flightId, share, {
      body,
      ...(parentId === undefined ? {} : { parentId }),
      ...(timecode !== null && attach ? { timecodeS: timecode } : {}),
    })
      .then(() => {
        setBody('');
        onDone?.();
        return client.invalidateQueries({ queryKey: commentsKey(flightId) });
      })
      .catch(() => setError(true))
      .finally(() => setSending(false));
  };

  return (
    <form onSubmit={submit} className="mt-2 flex flex-col gap-1">
      <textarea
        value={body}
        maxLength={COMMENT.maxLength}
        rows={parentId === undefined ? 2 : 1}
        onChange={(event) => setBody(event.target.value)}
        placeholder={t(parentId === undefined ? 'comments.placeholder' : 'comments.replyPlaceholder')}
        aria-label={t(parentId === undefined ? 'comments.placeholder' : 'comments.replyPlaceholder')}
        className="resize-y rounded bg-subtle px-2 py-1 text-primary placeholder:text-secondary"
      />
      <div className="flex flex-wrap items-center gap-3 text-xs">
        {timecode !== null && (
          <label className="flex items-center gap-1 text-secondary compact:min-h-11">
            <input type="checkbox" checked={attach} onChange={(event) => setAttach(event.target.checked)} className="accent-accent" />
            {fill(t('comments.attach'), { time: timecodeLabel(timecodeAt(timeMs ?? 0, timelineStartMs ?? startedAtMs ?? 0)) })}
          </label>
        )}
        <button
          type="submit"
          disabled={sending || body.trim() === ''}
          className="ml-auto rounded bg-accent px-3 py-1 font-semibold text-void disabled:opacity-50 compact:min-h-11"
        >
          {t('comments.send')}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {t('comments.error')}
        </p>
      )}
    </form>
  );
}
