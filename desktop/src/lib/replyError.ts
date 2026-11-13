import { t } from './i18n';

interface ReplyErrorPresentation {
  message: string;
  description?: string;
  details?: string;
}

/** A readable reason belongs in the timeline; expanded details hold the longer diagnostic. */
export function replyErrorPresentation(raw: string): ReplyErrorPresentation {
  const text = raw.trim();
  if (!text) return { message: t('replyFailed') };
  const limit = /^You['’]ve hit your ([1-9]\d*)-hour limit(?:\s*[·•]\s*resets\s+([^\r\n]+))?$/i.exec(text);
  if (limit) return {
    message: t('replyUsageLimit', { hours: limit[1] }),
    description: limit[2] ? t('replyUsageReset', { reset: limit[2] }) : undefined,
  };
  const firstLine = text.split(/\r?\n/, 1)[0];
  if (/^[{[<]/.test(firstLine)) return { message: t('replyFailed'), details: raw };
  const message = firstLine.length > 240 ? firstLine.slice(0, 240).trimEnd() + '…' : firstLine;
  return { message, details: message === text ? undefined : raw };
}
