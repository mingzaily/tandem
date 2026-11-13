import type { ToolItem } from './items';

export interface QuestionAnswerPair { question: string; answers: string[]; skipped: boolean }
type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue => value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {};
const parse = (text: string): unknown => { try { return JSON.parse(text); } catch { return null; } };
const answerItems = (value: unknown): string[] => {
  if (typeof value === 'string') {
    const decoded = parse(value);
    return Array.isArray(decoded) ? answerItems(decoded) : value.trim() ? [value] : [];
  }
  if (Array.isArray(value)) return value.flatMap(answerItems);
  return value && typeof value === 'object' ? answerItems(record(value).answers) : [];
};
const responseAnswers = (value: unknown): string[] | null => {
  const response = record(value);
  if (response.kind === 'freeform' && typeof response.text === 'string') return answerItems(response.text);
  if (response.kind === 'selection' && Array.isArray(response.selections)) return [...answerItems(response.selections), ...answerItems(response.comment)];
  return null;
};
const visibleQuestion = (value: string) => value.split('\n\nContext:\n', 1)[0];

/** Read actual tool answers, so restored and live histories produce the same compact record. */
export function questionAnswers(tool: ToolItem): QuestionAnswerPair[] | null {
  if (tool.result === null || tool.isError || !['ask_user', 'AskUserQuestion', 'request_user_input'].includes(tool.name)) return null;
  const input = record(parse(tool.input));
  const result = record(parse(tool.result));
  if (tool.name === 'ask_user') {
    if (result.kind === 'batch' && Array.isArray(result.questions) && Array.isArray(result.answers)) {
      const answers = result.answers;
      return result.questions.flatMap((entry, index) => {
        const question = record(entry).question;
        const answer = record(answers[index]);
        if (typeof question !== 'string') return [];
        const skipped = result.cancelled === true || answer.status === 'skipped';
        const values = skipped ? [] : responseAnswers(answer.response);
        return values === null ? [] : [{ question: visibleQuestion(question), answers: values, skipped }];
      });
    }
    const question = typeof result.question === 'string' ? result.question : input.question;
    if (typeof question !== 'string' || !question.trim()) return null;
    const display = visibleQuestion(question);
    if (result.cancelled === true) return [{ question: display, answers: [], skipped: true }];
    const values = responseAnswers(result.response);
    if (values) return [{ question: display, answers: values, skipped: values.length === 0 }];
    if (tool.result.startsWith('User answered: ')) return [{ question: display, answers: [tool.result.slice('User answered: '.length)], skipped: false }];
    if (tool.result === 'User cancelled the question') return [{ question: display, answers: [], skipped: true }];
    return null;
  }
  const questions = Array.isArray(input.questions) ? input.questions.map(record) : [];
  if (result.answers && typeof result.answers === 'object') return questions.flatMap((question) => {
    if (typeof question.question !== 'string') return [];
    const values = record(result.answers);
    const answer = (typeof question.id === 'string' ? values[question.id] : undefined) ?? values[question.question];
    if (answer === undefined) return [];
    const answers = answerItems(answer);
    return [{ question: visibleQuestion(question.question), answers, skipped: answers.length === 0 }];
  });
  if (tool.name === 'AskUserQuestion' && tool.result.startsWith('User has answered your questions:')) {
    const pairs: QuestionAnswerPair[] = [];
    for (const match of tool.result.matchAll(/"([^"\n]+)"="([^"\n]*)"/g)) {
      if (questions.some((question) => question.question === match[1])) pairs.push({ question: visibleQuestion(match[1]), answers: answerItems(match[2]), skipped: !match[2].trim() });
    }
    return pairs.length ? pairs : null;
  }
  return null;
}
