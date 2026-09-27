import { z } from 'zod';

import { FeedPilot } from './feed-dto.js';

/**
 * Комментарии к полёту (задача 3.10б, ТЗ §10). Привязка к моменту — секунды
 * от старта записи (flights.started_at): «вот здесь ушёл из термика». Ответы —
 * в один уровень (решение владельца 27.09.2026).
 */

export const COMMENT = {
  /** Разбор полёта — абзац-другой; длиннее — это уже статья, не комментарий. */
  maxLength: 2000,
} as const;

export const NewComment = z
  .object({
    body: z.string().trim().min(1).max(COMMENT.maxLength),
    /** Момент полёта, с от started_at; нет — комментарий ко всему полёту. */
    timecodeS: z.number().int().nonnegative().nullable().optional(),
    /** Ответ на комментарий верхнего уровня. */
    parentId: z.uuid().optional(),
  })
  .strict();
export type NewComment = z.infer<typeof NewComment>;

export const CommentDto = z.object({
  id: z.uuid(),
  parentId: z.uuid().nullable(),
  author: FeedPilot,
  /** null — комментарий удалён, но у него есть ответы: плашка «удалён». */
  body: z.string().nullable(),
  timecodeS: z.number().int().nonnegative().nullable(),
  createdAt: z.iso.datetime(),
  /** Спрашивающий может удалить: автор или владелец полёта. */
  canDelete: z.boolean(),
});
export type CommentDto = z.infer<typeof CommentDto>;

export const CommentsResponse = z.object({ comments: z.array(CommentDto) });
export type CommentsResponse = z.infer<typeof CommentsResponse>;
