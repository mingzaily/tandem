import type { QuestionAnswerPair } from './lib/questionAnswers';
import { t } from './lib/i18n';

export function QuestionAnswer({ pairs }: { pairs: QuestionAnswerPair[] }) {
  return <div className="answered-question">
    {pairs.map((pair, index) => <div key={index} className="answered-pair">
      <div><span aria-hidden>Q</span><p>{pair.question}</p></div>
      <div><span aria-hidden>{pair.skipped ? '–' : '✓'}</span><p className="answered-value">{pair.skipped || !pair.answers.length ? t('questionSkipped') : pair.answers.join('\n')}</p></div>
    </div>)}
  </div>;
}
