import test from 'node:test';
import assert from 'node:assert/strict';
import { deviceName } from '../src/lib/device.ts';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';
const IPAD_AS_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15';
const ANDROID_REDUCED = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';
const ANDROID_TABLET = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const ANDROID_LEGACY = 'Mozilla/5.0 (Linux; Android 13; SM-S9180 Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/116.0.0.0 Mobile Safari/537.36';
const FIREFOX_ANDROID = 'Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0';

test('iOS devices keep their family name because Safari hides the model', () => {
  assert.equal(deviceName({ userAgent: IPHONE, maxTouchPoints: 5 }), 'iPhone');
  assert.equal(deviceName({ userAgent: IPAD_AS_MAC, maxTouchPoints: 5 }), 'iPad');
  assert.equal(deviceName({ userAgent: IPAD_AS_MAC, maxTouchPoints: 0 }), 'Mac');
});

test('Android uses the Client Hints model, then a legacy user agent model, then the form factor', () => {
  assert.equal(deviceName({ userAgent: ANDROID_REDUCED, maxTouchPoints: 5, model: ' Pixel 8 ' }), 'Pixel 8');
  assert.equal(deviceName({ userAgent: ANDROID_LEGACY, maxTouchPoints: 5 }), 'SM-S9180');
  assert.equal(deviceName({ userAgent: ANDROID_REDUCED, maxTouchPoints: 5, model: '' }), 'Android 手机');
  assert.equal(deviceName({ userAgent: ANDROID_TABLET, maxTouchPoints: 5 }), 'Android 平板');
  assert.equal(deviceName({ userAgent: FIREFOX_ANDROID, maxTouchPoints: 5 }), 'Android 手机');
});

test('a model longer than the desktop shows is cut', () => {
  assert.equal(deviceName({ userAgent: ANDROID_REDUCED, maxTouchPoints: 5, model: 'x'.repeat(80) }).length, 40);
});
