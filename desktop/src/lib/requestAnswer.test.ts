import { describe, expect, it } from 'vitest';
import { requestAnswerFailure } from './requestAnswer';

describe('request answer failures', () => {
  it('keeps a failed answer available for retry', () => {
    expect(requestAnswerFailure({ code: 'answerFailed', message: '发送失败' })).toEqual({ settled: false, message: '发送失败' });
  });
  it('recognizes a request already answered elsewhere', () => {
    expect(requestAnswerFailure({ code: 'requestSettled', message: '请求已结束' })).toEqual({ settled: true, message: '请求已结束' });
  });
  it('treats an IPC transport failure as retryable', () => {
    expect(requestAnswerFailure('IPC connection closed')).toEqual({ settled: false, message: 'IPC connection closed' });
  });
});
