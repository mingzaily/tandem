import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReplyError } from '../src/ReplyError.tsx';

const render = (details: string) => renderToStaticMarkup(createElement(ReplyError, { details }));

test('quota failures show their cause and reported reset time directly on mobile', () => {
  const html = render("You've hit your 5-hour limit · resets 1am (Asia/Shanghai)");
  assert.match(html, /已达到 5 小时用量上限/);
  assert.match(html, /额度重置时间：1am \(Asia\/Shanghai\)/);
  assert.doesNotMatch(html, /<details|<pre/);
  assert.match(html, /aria-label="回复异常，本轮已结束"/);
});

test('a short readable failure is visible in the normal text column', () => {
  const html = render('Provider connection was closed.');
  assert.match(html, /<p>Provider connection was closed\.<\/p>/);
  assert.doesNotMatch(html, /<details|<pre/);
});

test('the exact malformed SSE error has a localized reason and keeps the native diagnostic', () => {
  const html = render('Error reading response: malformed server-sent event JSON.');
  assert.match(html, /模型响应流格式异常，本轮已结束/);
  assert.match(html, /<details>/);
  assert.doesNotMatch(html, /open=""/);
  assert.match(html, /malformed server-sent event JSON/);
});

test('long diagnostics retain their complete original text with a visible first-line reason', () => {
  const source = 'Connection closed by upstream\n    at Stream.read (stream.ts:20)\nrequest id: 123';
  const html = render(source);
  assert.match(html, /<p>Connection closed by upstream<\/p>/);
  assert.match(html, /<details>/);
  assert.doesNotMatch(html, /open=""/);
  assert.ok(html.includes(source));
});

test('protocol responses keep a generic outcome and folded diagnostics', () => {
  const html = render('{"error":"provider rejected"}');
  assert.match(html, /<p>回复异常，本轮已结束<\/p>/);
  assert.match(html, /<details>/);
  assert.doesNotMatch(html, /open=""/);
  assert.match(html, /provider rejected/);
});

test('missing error details keep a visible outcome and quota reset times are never invented', () => {
  assert.doesNotMatch(render('  \n '), /<details/);
  assert.match(render(''), /<p>回复异常，本轮已结束<\/p>/);
  const limit = render("You've hit your 5-hour limit");
  assert.match(limit, /已达到 5 小时用量上限/);
  assert.doesNotMatch(limit, /额度重置时间/);
  assert.match(render('Account unavailable'), /<p>Account unavailable<\/p>/);
});
