import type { QuestionAnswerPair } from '../lib/questionAnswers';
import { t } from '../lib/i18n';

/** Completed Q/A stays outside collapsed work, using Cindy’s compact prefix layout. */
export function QuestionAnswer({ pairs }: { pairs: QuestionAnswerPair[] }) {
  return <div data-question-answer className="selectable flex min-w-0 flex-col gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--surface-elevated)] px-4 py-3">
    {pairs.map((pair, index) => <div key={index} className={`flex min-w-0 flex-col gap-2 ${index ? 'border-t border-[var(--border-default)] pt-2' : ''}`}>
      <div className="flex items-start gap-2"><span aria-hidden className="w-3.5 shrink-0 text-11 leading-5 text-[var(--text-tertiary)]">Q</span>
        <span className="min-w-0 whitespace-pre-wrap text-13 leading-5 text-[var(--text-secondary)] [overflow-wrap:anywhere]">{pair.question}</span></div>
      <div className="flex items-start gap-2"><span aria-hidden className="w-3.5 shrink-0 text-12 leading-5 text-[var(--text-primary)]">{pair.skipped ? '–' : '✓'}</span>
        <div className="min-w-0 flex-1 whitespace-pre-wrap text-13 font-medium leading-5 text-[var(--text-primary)] [overflow-wrap:anywhere]">{pair.skipped || !pair.answers.length ? t('questionSkipped') : pair.answers.join('\n')}</div></div>
    </div>)}
  </div>;
}
